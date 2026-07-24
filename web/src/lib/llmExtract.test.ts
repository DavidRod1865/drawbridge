import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  configureLlmExtractor,
  extractWithLlm,
  resetLlmCircuit,
  shouldQueryLlm,
  LLM_CONFIDENCE_THRESHOLD,
} from './llmExtract.ts';
import { ProcoreApiError } from './api.ts';
import type { TextItem } from './sheetNumber.ts';

test('shouldQueryLlm gates on the confidence threshold', () => {
  assert.equal(shouldQueryLlm(0), true); // nothing found — let the LLM try
  assert.equal(shouldQueryLlm(0.49), true); // below the review line
  assert.equal(shouldQueryLlm(LLM_CONFIDENCE_THRESHOLD), false); // trusted outright
  assert.equal(shouldQueryLlm(0.9), false);
});

const items: TextItem[] = [{ text: 'A-101', x: 0.9, y: 0.94 }];

test('returns null when no extractor is configured', async () => {
  configureLlmExtractor(null);
  assert.equal(await extractWithLlm(items), null);
});

test('returns null for an empty page without calling the transport', async () => {
  let called = false;
  configureLlmExtractor(async () => {
    called = true;
    return { sheetNumber: 'A-101', title: null };
  });
  assert.equal(await extractWithLlm([]), null);
  assert.equal(called, false);
  configureLlmExtractor(null);
});

test('passes the page items to the transport and returns its result', async () => {
  let received: readonly TextItem[] | null = null;
  configureLlmExtractor(async (received_) => {
    received = received_;
    return { sheetNumber: 'A-101', title: 'FIRST FLOOR PLAN' };
  });
  const result = await extractWithLlm(items);
  assert.deepEqual(result, { sheetNumber: 'A-101', title: 'FIRST FLOOR PLAN' });
  assert.deepEqual(received, items);
  configureLlmExtractor(null);
});

test('swallows a transport failure and returns null', async () => {
  configureLlmExtractor(async () => {
    throw new Error('network down');
  });
  assert.equal(await extractWithLlm(items), null);
  configureLlmExtractor(null);
});

test('a 429 trips the breaker so the rest of the package skips the LLM', async () => {
  resetLlmCircuit();
  let calls = 0;
  configureLlmExtractor(async () => {
    calls += 1;
    throw new ProcoreApiError(429, 'rate limited');
  });
  assert.equal(await extractWithLlm(items), null); // first sheet hits the limit
  assert.equal(await extractWithLlm(items), null); // subsequent sheets skip entirely
  assert.equal(calls, 1, 'transport should only be called once after a 429');
  resetLlmCircuit();
  configureLlmExtractor(null);
});

test('resetLlmCircuit re-arms after a limit hit', async () => {
  configureLlmExtractor(async () => {
    throw new ProcoreApiError(429, 'rate limited');
  });
  await extractWithLlm(items); // trip it
  let calledAfterReset = false;
  configureLlmExtractor(async () => {
    calledAfterReset = true;
    return { sheetNumber: 'A-101', title: null };
  });
  resetLlmCircuit();
  await extractWithLlm(items);
  assert.equal(calledAfterReset, true);
  configureLlmExtractor(null);
});

test('a non-429 error does not trip the breaker', async () => {
  resetLlmCircuit();
  let calls = 0;
  configureLlmExtractor(async () => {
    calls += 1;
    throw new ProcoreApiError(500, 'server error');
  });
  await extractWithLlm(items);
  await extractWithLlm(items);
  assert.equal(calls, 2, 'a 5xx is per-sheet, not a package-wide trip');
  configureLlmExtractor(null);
});

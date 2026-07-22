import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  PENDING_DRAWING_SET_ID,
  isPendingDrawingSetId,
  resolveDrawingSetId,
} from './pendingDrawingSet.ts';
import type { DrawingSet } from './procore.ts';

describe('isPendingDrawingSetId', () => {
  it('recognizes the sentinel', () => {
    assert.equal(isPendingDrawingSetId(PENDING_DRAWING_SET_ID), true);
    assert.equal(isPendingDrawingSetId(42), false);
  });
});

describe('resolveDrawingSetId', () => {
  it('passes an existing Procore id through without creating', async () => {
    let created = false;
    const result = await resolveDrawingSetId({
      setId: 7,
      pendingName: 'ignored',
      create: async () => {
        created = true;
        return { id: 99, name: 'nope' };
      },
    });
    assert.deepEqual(result, { id: 7, created: null });
    assert.equal(created, false);
  });

  it('creates a pending draft and returns the Procore id', async () => {
    const createdSet: DrawingSet = { id: 55, name: 'IFC' };
    const result = await resolveDrawingSetId({
      setId: PENDING_DRAWING_SET_ID,
      pendingName: '  IFC  ',
      create: async (name) => {
        assert.equal(name, 'IFC');
        return createdSet;
      },
    });
    assert.deepEqual(result, { id: 55, created: createdSet });
  });

  it('rejects a pending draft with no name', async () => {
    await assert.rejects(
      () =>
        resolveDrawingSetId({
          setId: PENDING_DRAWING_SET_ID,
          pendingName: '   ',
          create: async () => ({ id: 1, name: 'x' }),
        }),
      /no name/,
    );
  });
});

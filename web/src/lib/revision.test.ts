import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareRawRevisions,
  compareRevisions,
  nextRevision,
  normalizeRevision,
} from './revision.ts';

test('normalizes common label formats to a comparable core', () => {
  assert.equal(normalizeRevision(' Rev 3 '), '3');
  assert.equal(normalizeRevision('REV-3'), '3');
  assert.equal(normalizeRevision('R.3'), '3');
  assert.equal(normalizeRevision('b'), 'B');
});

test('identical revisions are duplicates', () => {
  assert.equal(compareRevisions('2', '2'), 'same');
  // The normalizing wrapper makes formatting drift a duplicate, not a false revision.
  assert.equal(compareRawRevisions('Rev 2', '2'), 'same');
});

test('numeric revisions compare numerically, not lexically', () => {
  assert.equal(compareRevisions('3', '2'), 'newer');
  assert.equal(compareRevisions('2', '3'), 'older');
  // The case string comparison gets wrong.
  assert.equal(compareRevisions('10', '2'), 'newer');
});

test('alphabetic revisions handle rollover past Z', () => {
  assert.equal(compareRevisions('B', 'A'), 'newer');
  assert.equal(compareRevisions('A', 'B'), 'older');
  assert.equal(compareRevisions('AA', 'Z'), 'newer');
  assert.equal(compareRevisions('Z', 'AA'), 'older');
});

test('a sheet with no recorded revision is superseded by anything', () => {
  assert.equal(compareRevisions('A', ''), 'newer');
  assert.equal(compareRevisions('1', ''), 'newer');
});

test('mixed schemes defer to the user instead of guessing', () => {
  assert.equal(compareRevisions('1', 'A'), 'unknown');
  assert.equal(compareRevisions('A', '1'), 'unknown');
  assert.equal(compareRevisions('IFC', '2'), 'unknown');
});

test('a sheet Procore has never seen starts at revision 0', () => {
  assert.equal(nextRevision(null), '0');
  assert.equal(nextRevision(''), '0');
});

test('numeric revisions advance by one', () => {
  assert.equal(nextRevision('0'), '1');
  assert.equal(nextRevision('1'), '2');
  assert.equal(nextRevision('9'), '10');
  assert.equal(nextRevision('Rev 3'), '4');
});

test('alphabetic revisions advance a letter, rolling over past Z', () => {
  assert.equal(nextRevision('A'), 'B');
  assert.equal(nextRevision('Z'), 'AA');
  assert.equal(nextRevision('AZ'), 'BA');
});

test('an unrecognized scheme yields no suggestion rather than a wrong one', () => {
  assert.equal(nextRevision('IFC'), null);
});

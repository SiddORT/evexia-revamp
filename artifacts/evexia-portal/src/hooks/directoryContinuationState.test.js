import test from 'node:test';
import assert from 'node:assert/strict';
import { continuationPosition } from './directoryContinuationState.js';

test('changing a query or filters permanently discards its prior cursor', () => {
  const first = { scope: 'query-A', cursor: 'opaque-uuid' };
  assert.equal(continuationPosition(first, 'query-A'), first);
  const reset = continuationPosition(first, 'query-B');
  assert.equal(reset.cursor, null);
  const repeated = continuationPosition(reset, 'query-A');
  assert.equal(repeated.cursor, null);
});

test('actor and limit changes also discard continuation', () => {
  let state = { scope: 'actor-A:limit-10', cursor: 'opaque-uuid' };
  state = continuationPosition(state, 'actor-B:limit-10');
  assert.equal(state.cursor, null);
  state = { ...state, cursor: 'another-opaque-uuid' };
  state = continuationPosition(state, 'actor-B:limit-20');
  assert.equal(state.cursor, null);
});

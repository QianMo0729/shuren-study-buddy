import assert from 'node:assert/strict';
import test from 'node:test';
import { FEEDBACK_EXIT_DIRECTION, feedbackForDrag, feedbackForKey } from '../src/components/match/swipeDecision';

test('left and right drags keep their feedback and exit direction aligned', () => {
  for (const [offset, velocity, expected] of [
    [-111, 0, 'like'], [111, 0, 'dislike'],
    [-20, -801, 'like'], [20, 801, 'dislike'],
    [0, -801, 'like'], [0, 801, 'dislike'],
  ] as const) {
    assert.equal(feedbackForDrag(offset, velocity), expected);
    assert.equal(FEEDBACK_EXIT_DIRECTION[expected], Math.sign(offset || velocity));
  }
});

test('a short or slow drag snaps back without recording feedback', () => {
  for (const [offset, velocity] of [[0, 0], [-110, -800], [110, 800], [-50, 200], [50, -200]]) {
    assert.equal(feedbackForDrag(offset, velocity), null);
  }
});

test('keyboard directions match swipe choices and retain skip', () => {
  assert.equal(feedbackForKey('ArrowLeft'), 'like');
  assert.equal(feedbackForKey('ArrowRight'), 'dislike');
  assert.equal(feedbackForKey('ArrowDown'), 'skip');
  for (const key of ['ArrowUp', 'Enter', 'Escape', 'a']) assert.equal(feedbackForKey(key), null);
});

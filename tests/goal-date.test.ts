import assert from 'node:assert/strict';
import test from 'node:test';
import { beijingToday, goalDateError, goalDateInput, goalDateToIso, preserveDraftGoalDate } from '../shared/goalDate.ts';

test('eight-digit dates convert to the existing ISO storage format and render without separators', () => {
  assert.equal(goalDateToIso('20261231'), '2026-12-31');
  assert.equal(goalDateToIso('2026-12-31'), '2026-12-31');
  assert.equal(goalDateInput('2026-12-31'), '20261231');
  assert.equal(goalDateInput('２０２６１２３１'), '20261231');
  assert.equal(goalDateError('20261231', '2026-10-04'), null);
});

test('calendar validation handles leap years, impossible days and incomplete dates without erasing them', () => {
  assert.equal(goalDateToIso('20280229'), '2028-02-29');
  for (const raw of ['2026', '2026123', '20260230', '20260229', '21000229', '20261301', '20260001', '20261200', '20261232']) {
    assert.equal(goalDateToIso(raw), null, raw);
    assert.ok(goalDateError(raw, '2026-01-01'), raw);
    assert.equal(preserveDraftGoalDate(raw, ''), raw);
  }
  assert.match(goalDateError('202612', '2026-01-01')!, /完整的 8 位日期/);
  assert.match(goalDateError('20260230', '2026-01-01')!, /日期不存在/);
});

test('clearing the optional date is valid and preserves an empty answer', () => {
  assert.equal(goalDateToIso(''), '');
  assert.equal(goalDateError('', '2026-10-04'), null);
  assert.equal(goalDateInput(''), '');
  assert.equal(preserveDraftGoalDate('', '2026-12-31'), '');
});

test('the permitted date range includes Beijing today and 21001231', () => {
  assert.equal(beijingToday(Date.parse('2026-10-04T15:59:59.999Z')), '2026-10-04');
  assert.equal(beijingToday(Date.parse('2026-10-04T16:00:00.000Z')), '2026-10-05');
  assert.equal(goalDateError('20261004', '2026-10-04'), null);
  assert.match(goalDateError('20261003', '2026-10-04')!, /不能早于.*20261004/);
  assert.equal(goalDateError('21001231', '2026-10-04'), null);
  assert.match(goalDateError('21010101', '2026-10-04')!, /不能晚于 21001231/);
});

test('draft preservation only admits up to eight raw ASCII digits or the already sanitized value', () => {
  for (const raw of ['202612311', '2026<script>', '２０２６', 20261231, null, {}]) {
    assert.equal(preserveDraftGoalDate(raw, ''), '');
  }
  assert.equal(preserveDraftGoalDate('2026-12-31', '2026-12-31'), '2026-12-31');
});

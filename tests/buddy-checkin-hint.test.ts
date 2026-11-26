import assert from 'node:assert/strict';
import test from 'node:test';
import type { BuddyStatus } from '../shared/types';
import { buddyCheckinHint, buddyDayStatus, canTakeScoringCheckin } from '../src/components/checkin/buddyCheckinHint';

const date = '2026-11-26';
const at = '2026-11-26T02:00:00Z';
const now = Date.parse(at);
const mine = { at, counts: true, issue: null };
const partner = { at, counts: true, place: '图书馆' };
const rules = { windowMinutes: 30, distanceMeters: 300 };
const week = { start: '2026-11-23', end: '2026-11-29', cap: 7, count: 0, points: 0, bonus: 0, events: [] };

function status(entries: Partial<NonNullable<BuddyStatus['today']>>): BuddyStatus {
  return {
    today: { date, mine: null, partner: null, free: [], ...entries },
    pair: { id: 1, partner: { id: 2, nickname: '搭子', cover: null }, createdAt: at, startsOn: date, started: true, matchId: null, ineligible: null, showOnProfile: { mine: false, partner: false } },
    season: { start: date, end: '2027-01-10', status: 'running' },
    week, score: null, rank: null, invites: [], shurenMember: 'yes',
  };
}

test('a qualifying individual check-in waits through the inclusive time limit, and expires after it', () => {
  const one = status({ mine });
  const cutoff = now + rules.windowMinutes * 60_000;
  assert.match(buddyCheckinHint(one, rules, cutoff, at)!.text, /符合个人要求，正在等搭子/);
  assert.match(buddyCheckinHint(one, rules, cutoff + 1, at)!.text, /搭子未在 30 分钟内打卡/);
  assert.match(buddyCheckinHint(status({ partner }), rules, cutoff + 1)!.text, /已超过 30 分钟/);
});

test('the camera and first receipt explain pair rejection even when both first check-ins qualify', () => {
  for (const receipt of [undefined, at]) {
    const far = buddyCheckinHint(status({ mine, partner, pairOutcome: 'too_far' }), rules, now, receipt)!;
    assert.equal(far.tone, 'warn');
    assert.match(far.text, /相距超过 300 米，今天未计入同时打卡/);
    const late = buddyCheckinHint(status({ mine, partner, pairOutcome: 'too_late' }), rules, now, receipt)!;
    assert.match(late.text, /相差超过 30 分钟，今天未计入同时打卡/);
  }
});

test('both sides of a nonqualifying first check-in remain distinguishable', () => {
  const badMine = { ...mine, counts: false, issue: 'caption' as const };
  const badPartner = { ...partner, counts: false };
  assert.match(buddyCheckinHint(status({ mine, partner: badPartner }), rules, now, at)!.text, /符合个人要求。搭子的首次打卡未达标/);
  assert.match(buddyCheckinHint(status({ mine: badMine, partner: badPartner }), rules, now, at)!.text, /说明字数不够，搭子的首次打卡也未达标/);
});

test('an accepted pair event is shown on the first receipt and repeats are community-only', () => {
  const matched = status({ mine, partner, pairOutcome: 'matched' });
  const first = buddyCheckinHint(matched, rules, now, at)!;
  assert.equal(first.text, '你们今天已完成 1 次同时打卡。');
  const later = new Date(now + 60_000).toISOString();
  for (const receipt of [undefined, later]) {
    assert.match(buddyCheckinHint(matched, rules, now + 60_000, receipt)!.text, /已完成 1 次同时打卡。本次只记录社区打卡/);
  }
});

test('older responses can confirm a match only from the dated weekly event', () => {
  const old = status({ mine, partner });
  const event = { date, mine: '10:00', theirs: '10:00', place: '图书馆', distance: 50 };
  assert.match(buddyCheckinHint(old, rules, now)!.text, /未列入本周同时打卡记录/);
  old.week = { ...week, events: [{ ...event, date: '2026-11-25' }] };
  assert.notEqual(buddyCheckinHint(old, rules, now)!.tone, 'good');
  old.week.events.push(event);
  assert.equal(buddyCheckinHint(old, rules, now)!.tone, 'good');
});

test('a receipt from before Beijing midnight never displays the next day’s outcome', () => {
  const next = status({ date: '2026-11-27', mine, partner, pairOutcome: 'matched' });
  const hint = buddyCheckinHint(next, rules, now + 86_400_000, at)!;
  assert.match(hint.text, /11月26日/);
  assert.notEqual(hint.tone, 'good');
});

test('unqualified attempts leave the camera warnings enabled and identify who can try again', () => {
  const failed = { ...mine, counts: false, issue: 'deleted' as const };
  const day = status({ checkinPolicy: 'first_eligible', mine: failed });
  assert.equal(canTakeScoringCheckin(day), true);
  assert.match(buddyDayStatus(day, rules, now)!.text, /你 10:00 的打卡已删除/);
  const retry = buddyCheckinHint(day, rules, now, at)!;
  assert.match(retry.text, /你可以补拍/);
  assert.equal(retry.canRetake, true);
  day.today!.partner = partner;
  const expiredRetry = buddyCheckinHint(day, rules, now + 31 * 60_000, at)!;
  assert.match(expiredRetry.text, /已超过 30 分钟/);
  assert.ok(!expiredRetry.canRetake);
  day.today!.partner = { ...partner, counts: false, issue: 'deleted' };
  assert.match(buddyDayStatus(day, rules, now)!.text, /搭子 10:00 的打卡已删除.*你们都可以补拍/);
  day.today!.mine = mine;
  assert.equal(canTakeScoringCheckin(day), false);
  assert.match(buddyDayStatus(day, rules, now)!.text, /搭子还可以补拍/);
  const expired = buddyDayStatus(day, rules, now + 31 * 60_000)!.text;
  assert.match(expired, /未在 30 分钟内打卡/);
  assert.doesNotMatch(expired, /可以补拍/);
  assert.equal(canTakeScoringCheckin(status({ mine: failed })), false);
});

test('an earlier qualifying card stays selected after a time or distance mismatch', () => {
  for (const pairOutcome of ['too_late', 'too_far'] as const) {
    const day = status({ checkinPolicy: 'first_eligible', mine: { ...mine, checkinId: 12 }, partner, pairOutcome });
    assert.equal(canTakeScoringCheckin(day), false);
    const overview = buddyDayStatus(day, rules, now)!.text;
    assert.match(overview, /今天未计入同时打卡/);
    assert.doesNotMatch(overview, /社区|可以补拍/);
    assert.match(buddyCheckinHint(day, rules, now, at, 13)!.text, /本次只记录社区打卡/);
  }
});

test('a replacement receipt is distinguished from a duplicate even in the same second', () => {
  const day = status({
    checkinPolicy: 'first_eligible', mine: { ...mine, checkinId: 2, isReplacement: true }, partner, pairOutcome: 'matched',
  });
  assert.equal(buddyCheckinHint(day, rules, now, at, 2)!.text, '这张补拍已选为你今天的计分打卡。你们今天已完成 1 次同时打卡。');
  assert.match(buddyCheckinHint(day, rules, now, at, 3)!.text, /已完成 1 次同时打卡。本次只记录社区打卡/);
  assert.equal(buddyDayStatus(day, rules, now)!.text, '你们今天已完成 1 次同时打卡。');
});

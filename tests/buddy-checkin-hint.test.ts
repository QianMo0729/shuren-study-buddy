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
  const far = status({ mine, partner, pairOutcome: 'too_far' });
  const late = status({ mine, partner, pairOutcome: 'too_late' });
  const camera = buddyCheckinHint(far, rules, now)!;
  assert.equal(camera.tone, 'warn');
  assert.equal(camera.text, '相距超过 300 米，未计分 · 本次仅社区打卡');
  assert.match(buddyCheckinHint(late, rules, now)!.text, /相差超过 30 分钟，未计分/);
  assert.match(buddyCheckinHint(far, rules, now, at)!.text, /相距超过 300 米，今天未计入同时打卡/);
  assert.match(buddyCheckinHint(late, rules, now, at)!.text, /相差超过 30 分钟，今天未计入同时打卡/);
});

test('the live camera shows a short waiting status while the day view keeps the place and rules', () => {
  const waiting = status({ checkinPolicy: 'first_eligible', partner: { ...partner, place: '南方科技大学' } });
  const camera = buddyCheckinHint(waiting, rules, now)!;
  assert.equal(camera.text, '搭子 10:00 已打卡');
  assert.match(camera.details!, /南方科技大学.*最早保留的合格打卡.*30 分钟.*300 米/);
  assert.equal(camera.details!.match(/300 米/g)?.length, 1);
  assert.match(buddyDayStatus(waiting, rules, now)!.text, /南方科技大学.*30 分钟.*300 米/);
  assert.equal(buddyCheckinHint(status({}), rules, now)!.text, '两人今天均未打卡');
});

test('camera caption guidance follows scoring opportunities even when the partner must retake', () => {
  const badPartner = { ...partner, counts: false };
  const badMine = { ...mine, counts: false, issue: 'caption' as const };
  const day = status({ checkinPolicy: 'first_eligible', partner: badPartner });
  const firstShot = buddyCheckinHint(day, rules, now)!;
  assert.equal(firstShot.tone, 'warn');
  assert.equal(firstShot.canRetake, false);
  assert.equal(firstShot.canAddScoringCaption, true);

  const cutoff = now + rules.windowMinutes * 60_000;
  day.today!.mine = badMine;
  day.today!.partner = partner;
  assert.equal(buddyCheckinHint(day, rules, cutoff)!.canAddScoringCaption, true);
  assert.ok(!buddyCheckinHint(day, rules, cutoff + 1)!.canAddScoringCaption);
  assert.equal(canTakeScoringCheckin(day), true);
  assert.ok(!buddyCheckinHint(status({ partner: badPartner }), rules, now)!.canAddScoringCaption);
});

test('the camera omits caption guidance for community-only shots', () => {
  const noPair = { ...status({}), pair: null, today: null };
  const waiting = status({});
  waiting.pair!.started = false;
  const ended = status({});
  ended.season.status = 'ended';
  for (const day of [noPair, waiting, ended, status({ mine }), status({ mine, partner, pairOutcome: 'matched' })]) {
    assert.ok(!buddyCheckinHint(day, rules, now)?.canAddScoringCaption);
  }
  assert.equal(buddyCheckinHint(status({}), rules, now)!.canAddScoringCaption, true);
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
  assert.equal(buddyCheckinHint(matched, rules, now + 60_000)!.text, '今日同时打卡已完成 · 本次仅社区打卡');
  assert.match(buddyCheckinHint(matched, rules, now + 60_000, later)!.text, /已完成 1 次同时打卡。本次只记录社区打卡/);
});

test('older responses can confirm a match only from the dated weekly event', () => {
  const old = status({ mine, partner });
  const event = { date, mine: '10:00', theirs: '10:00', place: '图书馆', distance: 50 };
  assert.match(buddyCheckinHint(old, rules, now)!.text, /今日暂无同时打卡记录/);
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

test('a pair can retry a time or distance mismatch from the camera, receipt and day overview', () => {
  for (const [outcome, limit] of [['too_far', /相距超过 300 米/], ['too_late', /相差超过 30 分钟/]] as const) {
    const day = status({ checkinPolicy: 'first_matched_pair', mine: { ...mine, checkinId: 10 }, partner, pairOutcome: outcome });
    assert.equal(canTakeScoringCheckin(day), true);
    const camera = buddyCheckinHint(day, rules, now)!;
    assert.equal(camera.canAddScoringCaption, true);
    for (const hint of [camera, buddyCheckinHint(day, rules, now, at, 10)!, buddyDayStatus(day, rules, now)!]) {
      assert.match(hint.text, limit);
      assert.match(hint.text, /补拍/);
      assert.equal(hint.canRetake, true);
      assert.doesNotMatch(hint.text, /仅社区|只记录社区/);
    }
    const unselected = buddyCheckinHint(day, rules, now, at, 11)!;
    assert.match(unselected.text, /当前用于核对的是你 10:00 的合格打卡/);
    assert.equal(unselected.canRetake, true);
  }
});

test('either person can shoot again while waiting for a match, including after the time window', () => {
  const day = status({ checkinPolicy: 'first_matched_pair', mine, pairOutcome: null });
  const afterCutoff = now + rules.windowMinutes * 60_000 + 1;
  for (const readAt of [now, afterCutoff]) {
    assert.equal(canTakeScoringCheckin(day), true);
    assert.equal(buddyCheckinHint(day, rules, readAt, at)!.canRetake, true);
    assert.equal(buddyCheckinHint(day, rules, readAt)!.canAddScoringCaption, true);
  }
  assert.match(buddyCheckinHint(day, rules, afterCutoff)!.text, /超时，可以补拍/);
  day.today!.mine = null;
  day.today!.partner = partner;
  assert.equal(buddyCheckinHint(day, rules, afterCutoff)!.canAddScoringCaption, true);
  assert.match(buddyDayStatus(day, rules, afterCutoff)!.text, /请搭子补拍/);
  day.today!.mine = { ...mine, counts: false, issue: 'caption' };
  const receipt = buddyCheckinHint(day, rules, afterCutoff, at)!;
  assert.equal(receipt.canRetake, true);
  assert.match(receipt.text, /说明字数不够/);
});

test('the first successful pair identifies the scoring receipt and ends scoring opportunities for the day', () => {
  const day = status({
    checkinPolicy: 'first_matched_pair', mine: { ...mine, checkinId: 7, isReplacement: true }, partner, pairOutcome: 'matched',
  });
  const receipt = buddyCheckinHint(day, rules, now, at, 7)!;
  assert.equal(receipt.tone, 'good');
  assert.match(receipt.text, /这张补拍已选为你今天的计分打卡/);
  assert.ok(!receipt.canRetake);
  assert.equal(canTakeScoringCheckin(day), false);
  assert.ok(!buddyCheckinHint(day, rules, now)!.canAddScoringCaption);
  assert.match(buddyCheckinHint(day, rules, now, at, 8)!.text, /本次只记录社区打卡/);
});

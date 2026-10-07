import assert from 'node:assert/strict';
import test from 'node:test';
import { createRateLimiter, ipKey } from '../server/rateLimit.ts';

test('a key allows `max` hits per window and starts over when the window ends', () => {
  const limiter = createRateLimiter();
  for (let i = 0; i < 3; i++) assert.equal(limiter.hit('a', 3, 1000, 0), true);
  assert.equal(limiter.hit('a', 3, 1000, 999), false);
  assert.equal(limiter.hit('b', 3, 1000, 999), true, 'keys are independent');
  assert.equal(limiter.hit('a', 3, 1000, 1000), true, 'a new window begins at the reset time');
  assert.equal(limiter.size, 2);
});

test('the number of keys is capped: a flood of new keys is refused and cannot evict live counters', () => {
  const limiter = createRateLimiter(1000);
  assert.equal(limiter.hit('login-email:victim', 2, 60_000, 0), true);
  assert.equal(limiter.hit('login-email:victim', 2, 60_000, 0), true);
  for (let i = 0; i < 5000; i++) limiter.hit(`flood:${i}`, 10, 60_000, 1);
  assert.equal(limiter.size, 1000, 'memory stays bounded however many distinct keys arrive');
  assert.equal(limiter.hit('flood:4999', 10, 60_000, 2), false, 'new keys are refused while the table is full');
  // The victim's counter survived the flood, so the flood did not reset anyone's limit.
  assert.equal(limiter.hit('login-email:victim', 2, 60_000, 2), false);
});

test('expired keys are reclaimed a few per call, never by scanning the whole table', () => {
  const sweepPerHit = 8;
  const limiter = createRateLimiter(1000, sweepPerHit);
  for (let i = 0; i < 1000; i++) limiter.hit(`old:${i}`, 1, 1000, 0);
  assert.equal(limiter.size, 1000);
  // After expiry, one call removes at most `sweepPerHit` entries: its cost does not depend on the table size.
  assert.equal(limiter.hit('new:0', 1, 1000, 5000), true);
  assert.equal(limiter.size, 1000 - sweepPerHit + 1);
  // ...and keeps reclaiming, so a full table of expired keys drains instead of locking everyone out.
  for (let i = 1; i <= 200; i++) assert.equal(limiter.hit(`new:${i}`, 1, 60_000, 5000), true);
  assert.equal(limiter.size, 201, 'all 1000 expired keys are gone; only the live ones remain');
});

test('work per call stays flat as the table grows', () => {
  const time = (keys: number) => {
    const limiter = createRateLimiter(keys);
    for (let i = 0; i < keys; i++) limiter.hit(`k:${i}`, 1, 60_000, 0);
    const start = process.hrtime.bigint();
    for (let i = 0; i < 20_000; i++) limiter.hit(`extra:${i}`, 1, 60_000, 1);
    return Number(process.hrtime.bigint() - start) / 1e6;
  };
  time(1000); // warm up
  const [small, large] = [time(1000), time(50_000)];
  // A full scan per call would make the large table ~50× slower; allow generous noise.
  assert.ok(large < small * 10 + 50, `20k calls took ${small.toFixed(1)}ms at 1k keys and ${large.toFixed(1)}ms at 50k keys`);
});

test('source keys: IPv4 per address, IPv6 per /64', () => {
  assert.equal(ipKey('203.0.113.9'), '203.0.113.9');
  assert.equal(ipKey('::ffff:203.0.113.9'), '203.0.113.9');
  assert.equal(ipKey('2001:db8:5:6::1'), ipKey('2001:db8:5:6:aaaa:bbbb:cccc:dddd'));
  assert.equal(ipKey('2001:db8:5:6::1'), '2001:db8:5:6::/64');
  assert.notEqual(ipKey('2001:db8:5:6::1'), ipKey('2001:db8:5:7::1'));
  assert.equal(ipKey('::1'), '0:0:0:0::/64');
  assert.equal(ipKey('fe80::1%en0'), 'fe80:0:0:0::/64');
  assert.equal(ipKey(undefined), 'unknown');
});

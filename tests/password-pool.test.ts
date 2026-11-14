import assert from 'node:assert/strict';
import test from 'node:test';
import bcrypt from 'bcryptjs';
import { PASSWORD_POOL, PasswordPoolError, createPasswordPool } from '../server/passwordPool.ts';

const reason = (error: unknown) => (error instanceof PasswordPoolError ? error.reason : `unexpected: ${String(error)}`);

test('passwords are hashed and verified off the main thread, compatible with bcryptjs', { timeout: 60_000 }, async (t) => {
  const pool = createPasswordPool({ ...PASSWORD_POOL, workers: 1 });
  t.after(() => pool.close());

  const hash = await pool.hash('Correct-Horse-2026', 4);
  assert.match(hash, /^\$2[aby]\$04\$/);
  assert.equal(await bcrypt.compare('Correct-Horse-2026', hash), true, 'hashes made in the worker verify on the main thread');
  assert.equal(await pool.verify('Correct-Horse-2026', hash), true);
  assert.equal(await pool.verify('correct-horse-2026', hash), false);
  // Hashes stored before the pool existed keep working.
  assert.equal(await pool.verify('Legacy-Password-1', bcrypt.hashSync('Legacy-Password-1', 4)), true);
  // A value that is not a bcrypt hash is simply not a match.
  assert.equal(await pool.verify('anything', 'not-a-hash'), false);
});

test('a burst of logins does not stall the event loop', { timeout: 60_000 }, async (t) => {
  const pool = createPasswordPool({ ...PASSWORD_POOL, workers: 1 });
  t.after(() => pool.close());
  const hash = bcrypt.hashSync('Production-Cost-12', 12);
  await pool.verify('warm up the worker', hash);
  let maxGap = 0;
  let last = performance.now();
  const ticker = setInterval(() => { const now = performance.now(); maxGap = Math.max(maxGap, now - last); last = now; }, 5);
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) => pool.verify(i === 0 ? 'Production-Cost-12' : 'wrong password', hash)));
  clearInterval(ticker);
  assert.deepEqual(results, [true, false, false, false, false, false]);
  assert.ok(maxGap < 250, `the main thread kept running during six cost-12 comparisons (longest pause ${Math.round(maxGap)}ms)`);
});

test('concurrency is fixed and the queue is bounded', { timeout: 60_000 }, async (t) => {
  const pool = createPasswordPool({ ...PASSWORD_POOL, workers: 1, maxQueue: 2 });
  t.after(() => pool.close());
  const hash = bcrypt.hashSync('Queue-Fixture-1', 4);
  const jobs = Array.from({ length: 5 }, () => pool.verify('Queue-Fixture-1', hash));
  assert.equal(pool.running, 1, 'concurrency does not grow with the number of submissions');
  assert.equal(pool.queued, 2);
  const settled = await Promise.allSettled(jobs);
  assert.deepEqual(settled.map((r) => (r.status === 'fulfilled' ? String(r.value) : reason(r.reason))), ['true', 'true', 'true', 'busy', 'busy']);
  assert.equal(pool.running, 0);
  assert.equal(await pool.verify('Queue-Fixture-1', hash), true, 'the pool keeps working after refusing work');

  // A computation that exceeds its time budget is terminated; the next one gets a fresh worker.
  const impatient = createPasswordPool({ ...PASSWORD_POOL, workers: 1, timeoutMs: 1 });
  t.after(() => impatient.close());
  await assert.rejects(impatient.hash('Too-Slow-For-1ms', 12), (e) => reason(e) === 'timeout');
  assert.equal(impatient.running, 0);
});

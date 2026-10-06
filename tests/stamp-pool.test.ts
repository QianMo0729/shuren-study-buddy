import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import jpeg from 'jpeg-js';
import { STAMP_POOL, StampError, createStampPool } from '../server/stampPool.ts';
import { DECODE_LIMITS } from '../server/watermark.ts';

const LINES = ['南科大·琳恩图书馆', '2026-10-06 12:00:00 北京时间'];
const photo = (width: number, height: number, noise = false) =>
  jpeg.encode({ data: noise ? crypto.randomBytes(width * height * 4) : Buffer.alloc(width * height * 4, 180), width, height }, 80).data;
const reason = (error: unknown) => (error instanceof StampError ? error.reason : `unexpected: ${String(error)}`);

test('stamping runs off the main thread, with fixed concurrency and a bounded queue', { timeout: 60_000 }, async (t) => {
  const pool = createStampPool({ ...STAMP_POOL, workers: 1, maxQueue: 2 });
  t.after(() => pool.close());
  const small = photo(640, 480);

  const out = await pool.stamp(small, LINES);
  const decoded = jpeg.decode(out, { useTArray: true });
  assert.deepEqual([decoded.width, decoded.height], [640, 480]);
  assert.notDeepEqual(out, small, 'the photo was re-encoded with the watermark');

  // One job runs, two wait; anything beyond that is refused immediately instead of piling up.
  const jobs = Array.from({ length: 5 }, () => pool.stamp(small, LINES));
  assert.equal(pool.running, 1, 'concurrency does not grow with the number of submissions');
  assert.equal(pool.queued, 2);
  assert.equal(pool.saturated, true);
  const settled = await Promise.allSettled(jobs);
  assert.deepEqual(settled.map((r) => (r.status === 'fulfilled' ? 'ok' : reason(r.reason))), ['ok', 'ok', 'ok', 'busy', 'busy']);
  assert.equal(pool.saturated, false);
  assert.equal(pool.running, 0);
});

test('the largest accepted photo is stamped without stalling the event loop', { timeout: 60_000 }, async (t) => {
  const pool = createStampPool({ ...STAMP_POOL, workers: 1 });
  t.after(() => pool.close());
  // Worst case within the limits: about four megapixels of incompressible noise.
  const worst = photo(2560, 1560, true);
  assert.ok(2560 * 1560 <= DECODE_LIMITS.maxResolutionInMP * 1_000_000);
  let maxGap = 0;
  let last = performance.now();
  const ticker = setInterval(() => { const now = performance.now(); maxGap = Math.max(maxGap, now - last); last = now; }, 5);
  const started = performance.now();
  const out = await pool.stamp(worst, LINES);
  const elapsed = performance.now() - started;
  clearInterval(ticker);
  assert.ok(out.length > 0);
  assert.ok(elapsed < STAMP_POOL.timeoutMs, `worst case took ${Math.round(elapsed)}ms`);
  assert.ok(maxGap < 250, `the main thread kept running during the ${Math.round(elapsed)}ms job (longest pause ${Math.round(maxGap)}ms)`);
});

test('bad photos, oversized photos and stuck jobs fail cleanly and the pool keeps working', { timeout: 60_000 }, async (t) => {
  const pool = createStampPool({ ...STAMP_POOL, workers: 1 });
  t.after(() => pool.close());
  await assert.rejects(pool.stamp(Buffer.from('not a jpeg'), LINES), (e) => reason(e) === 'failed');
  // Beyond the decoder's pixel budget: refused by the decoder itself, whatever the route validated.
  await assert.rejects(pool.stamp(photo(2600, 1600), LINES), (e) => reason(e) === 'failed');
  assert.ok((await pool.stamp(photo(320, 240), LINES)).length > 0);

  // A job that exceeds its time budget is terminated; the next one gets a fresh worker.
  const impatient = createStampPool({ ...STAMP_POOL, workers: 1, timeoutMs: 1 });
  t.after(() => impatient.close());
  await assert.rejects(impatient.stamp(photo(2560, 1560, true), LINES), (e) => reason(e) === 'timeout');
  assert.equal(impatient.running, 0);
  assert.ok((await pool.stamp(photo(320, 240), LINES)).length > 0);
});

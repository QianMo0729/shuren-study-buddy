import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DEFAULT_ACTIVITY_CONFIG } from '../shared/activity.ts';

// 开始计分日按固定的日期和时刻核对，不依赖跑测试的那天是星期几；独立临时库，不启动 HTTP 服务。
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'study-buddy-start-'));
process.env.DATA_DIR = dir;
const { db } = await import('../server/db.ts');
const { saveActivityConfig } = await import('../server/activityConfig.ts');
const { startsOnFor } = await import('../server/buddies.ts');
const { scoringStart } = await import('../server/scoring.ts');

test('the scoring start follows the published rule at fixed times around a Thursday season start', async (t) => {
  t.after(async () => { db.close(); await fs.rm(dir, { recursive: true, force: true }); });
  const config = { ...DEFAULT_ACTIVITY_CONFIG, seasonStart: '2026-11-26', seasonEnd: '2027-01-10' };
  saveActivityConfig(config);
  const at = (beijing: string) => new Date(`${beijing}+08:00`);

  // 绑定时定下的日期：赛季开始前（含开赛那一周的周一到周三）是赛季第一天；开赛当天起是下一个周一
  assert.equal(startsOnFor(at('2026-11-22T23:59:59')), '2026-11-26');
  assert.equal(startsOnFor(at('2026-11-23T00:00:00')), '2026-11-26', 'Monday of the opening week: the 26th, not the 30th');
  assert.equal(startsOnFor(at('2026-11-25T23:59:59')), '2026-11-26');
  assert.equal(startsOnFor(at('2026-11-26T00:00:00')), '2026-11-30', 'bound on the first day of the season: the next Monday');
  assert.equal(startsOnFor(at('2026-11-29T23:59:59')), '2026-11-30');
  assert.equal(startsOnFor(at('2026-11-30T00:00:00')), '2026-12-07');

  // 实际开始计分日按北京时间的绑定日期算（created_at 是 UTC），旧代码存成 11-30 的记录也按规则算成 11-26
  const start = (createdAt: string, startsOn: string, c = config) => scoringStart({ created_at: createdAt, starts_on: startsOn }, c);
  assert.equal(start('2026-11-22 16:00:00', '2026-11-30'), '2026-11-26', 'Monday 00:00 in Beijing is still Sunday in UTC');
  assert.equal(start('2026-11-25 15:59:59', '2026-11-30'), '2026-11-26', 'Wednesday 23:59:59 in Beijing');
  assert.equal(start('2026-11-25 16:00:00', '2026-11-30'), '2026-11-30', 'Thursday 00:00 in Beijing: bound on the first day');
  assert.equal(start('2026-11-25 23:59:59', '2026-11-30'), '2026-11-30', 'Thursday 07:59:59 in Beijing is still Wednesday in UTC');
  assert.equal(start('2026-11-10 04:00:00', '2026-11-23'), '2026-11-26', 'bound before the season was moved: follows the season');
  assert.equal(start('2026-11-20 04:00:00', '2026-11-26'), '2026-11-26');
  assert.equal(start('2026-11-27 04:00:00', '2026-11-30'), '2026-11-30', 'bound during the season: the next Monday');
  // 赛季推迟：比新的第一天更早绑定的都从新的第一天算
  const postponed = { ...config, seasonStart: '2026-12-03' };
  assert.equal(start('2026-11-27 04:00:00', '2026-11-30', postponed), '2026-12-03');
  assert.equal(start('2026-12-03 04:00:00', '2026-12-07', postponed), '2026-12-07');
});

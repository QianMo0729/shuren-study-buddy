// 活动规则参数：存在 settings 表里，管理员可在后台修改；没有设置过时用 shared/activity.ts 的默认值。
import { DEFAULT_ACTIVITY_CONFIG, beijingDay, validateActivityConfig, type ActivityConfig } from '../shared/activity.ts';
import type { SeasonInfo } from '../shared/types.ts';
import { getSetting, setSetting } from './db.ts';

const KEY = 'activity_config';
let cached: { raw: string; config: ActivityConfig } | null = null;

export function activityConfig(): ActivityConfig {
  const raw = getSetting(KEY, '');
  if (cached && cached.raw === raw) return cached.config;
  let config = DEFAULT_ACTIVITY_CONFIG;
  if (raw) {
    try {
      const checked = validateActivityConfig({ ...DEFAULT_ACTIVITY_CONFIG, ...JSON.parse(raw) });
      if ('config' in checked) config = checked.config;
    } catch { /* 损坏的设置按默认值处理 */ }
  }
  cached = { raw, config };
  return config;
}

export function saveActivityConfig(config: ActivityConfig) {
  setSetting(KEY, JSON.stringify(config));
}

export function seasonInfo(now = new Date(), config = activityConfig()): SeasonInfo {
  const today = beijingDay(now);
  const status = today < config.seasonStart ? 'upcoming' : today > config.seasonEnd ? 'ended' : 'running';
  return { start: config.seasonStart, end: config.seasonEnd, status };
}

import { useEffect, useState } from 'react';
import { DEFAULT_ACTIVITY_CONFIG, type ActivityConfig } from '../../shared/activity';
import type { SeasonInfo } from '../../shared/types';
import { api } from './api';

type Loaded = { config: ActivityConfig; season: SeasonInfo };
let cached: Loaded | null = null;
let pending: Promise<Loaded> | null = null;

/** 活动规则参数（规则页、打卡页、搭子榜共用）。读取失败时先用默认值，页面不必等待 */
export function useActivityConfig(): Loaded & { loaded: boolean } {
  const [value, setValue] = useState<Loaded | null>(cached);
  useEffect(() => {
    if (cached) return;
    pending ??= api.activity.config().then((r) => (cached = r)).finally(() => { pending = null; });
    let alive = true;
    pending.then((r) => alive && setValue(r)).catch(() => {});
    return () => { alive = false; };
  }, []);
  const fallback: Loaded = {
    config: DEFAULT_ACTIVITY_CONFIG,
    season: { start: DEFAULT_ACTIVITY_CONFIG.seasonStart, end: DEFAULT_ACTIVITY_CONFIG.seasonEnd, status: 'upcoming' },
  };
  return { ...(value ?? fallback), loaded: !!value };
}

/** 修改设置后让下一次读取拿到新值 */
export function forgetActivityConfig() {
  cached = null;
}

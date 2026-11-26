import { useCallback, useEffect, useRef, useState } from 'react';
import type { BuddyStatus } from '../../shared/types';
import { api } from './api';
import { cached, setCached } from './cache';

/** 只刷新当前组合的活动信息，离开页面或有本地操作后忽略旧请求。 */
export function useBuddyStatus() {
  const [snapshot, setSnapshot] = useState(() => ({
    data: cached<BuddyStatus>('activity:me') ?? null,
    readAt: null as number | null,
    error: null as unknown,
  }));
  const mounted = useRef(false);
  const pending = useRef<symbol | null>(null);

  const setData = useCallback((data: BuddyStatus) => {
    if (!mounted.current) return;
    pending.current = null;
    setCached('activity:me', data);
    setSnapshot({ data, readAt: Date.now(), error: null });
  }, []);

  const reload = useCallback(async () => {
    if (!mounted.current || document.hidden || pending.current) return;
    const request = Symbol();
    pending.current = request;
    const readAt = Date.now();
    try {
      const data = await api.activity.me();
      if (pending.current !== request) return;
      setCached('activity:me', data);
      setSnapshot({ data, readAt, error: null });
    } catch (error) {
      if (pending.current === request) setSnapshot((prev) => ({ ...prev, readAt: null, error }));
    } finally {
      if (pending.current === request) pending.current = null;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void reload();
    const timer = window.setInterval(reload, 30_000);
    document.addEventListener('visibilitychange', reload);
    window.addEventListener('pageshow', reload);
    return () => {
      mounted.current = false;
      pending.current = null;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', reload);
      window.removeEventListener('pageshow', reload);
    };
  }, [reload]);

  return { ...snapshot, reload, setData };
}

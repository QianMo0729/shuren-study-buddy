import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../lib/api';

/** 服务器要求：凭证签发后至少 0.5 秒才能提交；这里多留一点余量 */
const MIN_AGE_MS = 650;
/** 过期前多久续领 */
const RENEW_BEFORE_MS = 30_000;

interface Held {
  token: string;
  /** 收到凭证时的本机时间 */
  receivedAt: number;
  /** 按本机时钟换算的过期时间 */
  expiresAt: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 实时拍照凭证：摄像头打开后领取，过期前自动续领；同时用服务器时间校准本机时钟（水印预览用）。
 * take() 交出一个可用的凭证并作废本地副本——每个凭证只能提交一次。
 */
export function useCheckinSession(active: boolean) {
  const held = useRef<Held | null>(null);
  const [ready, setReady] = useState(false);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inflight = useRef<Promise<Held> | null>(null);

  const fetchSession = useCallback(() => {
    if (inflight.current) return inflight.current;
    const p = (async () => {
      const t0 = Date.now();
      const s = await api.checkins.session();
      const t1 = Date.now();
      // 服务器时间取请求往返的中点
      setOffset(Date.parse(s.serverTime) + (t1 - t0) / 2 - t1);
      const h: Held = { token: s.token, receivedAt: t1, expiresAt: t1 + Date.parse(s.expiresAt) - Date.parse(s.serverTime) };
      held.current = h;
      setReady(true);
      setError(null);
      return h;
    })();
    inflight.current = p;
    p.finally(() => { inflight.current = null; }).catch(() => {});
    return p;
  }, []);

  useEffect(() => {
    if (!active) {
      held.current = null;
      setReady(false);
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      let next = 15_000;
      try {
        const h = await fetchSession();
        next = Math.max(10_000, h.expiresAt - Date.now() - RENEW_BEFORE_MS);
      } catch (e) {
        if (!cancelled) setError(e instanceof ApiError ? e.message : '暂时无法连接服务器');
      }
      if (!cancelled) timer = setTimeout(run, next);
    };
    void run();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, fetchSession]);

  /** 取出一个至少还有 10 秒有效期、且已签发足够久的凭证 */
  const take = useCallback(async () => {
    let h = held.current;
    if (!h || h.expiresAt - Date.now() < 10_000) h = await fetchSession();
    const wait = h.receivedAt + MIN_AGE_MS - Date.now();
    if (wait > 0) await sleep(wait);
    if (held.current === h) {
      held.current = null;
      setReady(false);
    }
    return h.token;
  }, [fetchSession]);

  /** 提交失败后换一个新凭证（失败的凭证可能已被服务器作废） */
  const renew = useCallback(() => {
    held.current = null;
    setReady(false);
    fetchSession().catch((e) => setError(e instanceof ApiError ? e.message : '暂时无法连接服务器'));
  }, [fetchSession]);

  return { ready, offset, error, take, renew };
}

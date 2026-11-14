import { lazy, type ComponentType } from 'react';

const RELOAD_KEY = 'dz-chunk-reload';
const RELOAD_COOLDOWN_MS = 30_000;

/**
 * 发布新版本后，已经打开的旧页面会请求不再存在的分块。这时刷新一次页面拿到新版本；
 * 离线、刚刷新过仍然失败、或无法记录刷新时间时不刷新，把错误交给 PageBoundary 显示。
 */
function recover(error: unknown): Promise<never> {
  if (navigator.onLine === false) throw error;
  try {
    if (Date.now() - Number(sessionStorage.getItem(RELOAD_KEY) ?? 0) < RELOAD_COOLDOWN_MS) throw error;
    sessionStorage.setItem(RELOAD_KEY, String(Date.now()));
  } catch {
    throw error;
  }
  window.location.reload();
  return new Promise(() => {});
}

/** 按需加载的页面。preload() 提前把分块取回来，之后切到这个页面时不用再等 */
export function lazyPage<P extends object>(load: () => Promise<ComponentType<P>>) {
  let pending: Promise<{ default: ComponentType<P> }> | undefined;
  const fetchOnce = () =>
    (pending ??= load().then(
      (component) => ({ default: component }),
      (error) => {
        pending = undefined;
        throw error;
      },
    ));
  return Object.assign(lazy(() => fetchOnce().catch(recover)), {
    preload: () => {
      fetchOnce().catch(() => {});
    },
  });
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { onAccountChanged } from './auth';

/**
 * 页面数据的内存缓存：回到看过的页面时先显示上次的内容，同时在后台重新加载，不再每次都闪一下骨架屏。
 * 只存在内存里（刷新或关掉页面就没了）；换账号或退出登录时全部清空。
 */
const store = new Map<string, unknown>();
onAccountChanged(() => store.clear());

export const cached = <T>(key: string) => store.get(key) as T | undefined;
export const setCached = (key: string, value: unknown) => { store.set(key, value); };
export const dropCached = (prefix: string) => {
  for (const key of store.keys()) if (key.startsWith(prefix)) store.delete(key);
};

/**
 * 读取并缓存一份数据：有缓存时立即返回缓存，同时重新加载；key 变化时按新的 key 重新开始。
 * error 只在没有任何数据可显示时才有意义（有旧数据时加载失败就继续显示旧数据）。
 */
export function useCached<T>(key: string | null, load: () => Promise<T>) {
  const [data, setData] = useState<T | undefined>(() => (key ? cached<T>(key) : undefined));
  const [error, setError] = useState<unknown>(null);
  const [version, setVersion] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  const shownKey = useRef(key);

  useEffect(() => {
    if (!key) return;
    if (shownKey.current !== key) {
      shownKey.current = key;
      setData(cached<T>(key));
    }
    let live = true;
    setError(null);
    loadRef.current().then(
      (value) => {
        if (!live) return;
        store.set(key, value);
        setData(value);
      },
      (cause) => { if (live) setError(cause); },
    );
    return () => { live = false; };
  }, [key, version]);

  const update = useCallback((value: T) => {
    if (key) store.set(key, value);
    setData(value);
  }, [key]);

  return { data, error, reload: useCallback(() => setVersion((v) => v + 1), []), setData: update };
}

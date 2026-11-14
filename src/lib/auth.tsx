import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { SessionUser } from '../../shared/types';
import { api, ApiError } from './api';
import { purgeAccountDrafts } from './questionnaireDraft';

interface AuthState {
  user: SessionUser | null;
  loading: boolean;
  refresh: () => Promise<SessionUser | null>;
  setUser: (u: SessionUser | null) => void;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState>(null!);

/** 登录账号变化（退出、换号）时广播，模块级缓存据此清空，避免上一位同学的内容出现在下一位的屏幕上 */
export const ACCOUNT_CHANGED = 'dz:account-changed';
export function onAccountChanged(handler: () => void) {
  if (typeof window !== 'undefined') window.addEventListener(ACCOUNT_CHANGED, handler);
}

/** 上一次确认过的登录状态：冷启动时先用它把页面画出来，同时在后台向服务器确认 */
const LAST_USER = 'dz-last-user';
function lastUser(): SessionUser | null {
  try {
    const raw = localStorage.getItem(LAST_USER);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed.id === 'number' && typeof parsed.role === 'string' ? parsed as SessionUser : null;
  } catch {
    return null;
  }
}
function rememberUser(user: SessionUser | null) {
  try {
    if (user) localStorage.setItem(LAST_USER, JSON.stringify(user));
    else localStorage.removeItem(LAST_USER);
  } catch { /* Storage can be disabled. */ }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [initial] = useState(lastUser);
  const [user, setUserState] = useState<SessionUser | null>(initial);
  const [loading, setLoading] = useState(!initial);
  const revision = useRef(0);
  const accountId = useRef<number | null | undefined>(undefined);
  const updateUser = useCallback((next: SessionUser | null, confirmed = true) => {
    const id = next?.id ?? null;
    // 服务器确认了当前账号（或确认已退出：退出登录、会话失效、注销）之后，本机只保留这个账号的未提交草稿。
    // 仅仅是连不上服务器时不清理，离线期间填写的内容还要等联网后同步。
    if (confirmed) {
      try { purgeAccountDrafts(localStorage, id); } catch { /* Storage can be disabled. */ }
    }
    if (accountId.current !== undefined && accountId.current !== id) window.dispatchEvent(new CustomEvent(ACCOUNT_CHANGED));
    accountId.current = id;
    if (confirmed) rememberUser(next);
    setUserState(next);
  }, []);

  const setUser = useCallback((next: SessionUser | null) => {
    revision.current += 1;
    updateUser(next);
    setLoading(false);
  }, [updateUser]);

  const refresh = useCallback(async () => {
    const requestRevision = ++revision.current;
    try {
      const { user } = await api.me();
      if (requestRevision === revision.current) updateUser(user);
      return user;
    } catch (error) {
      // 只是连不上服务器（离线、信号差）：先保留上次的登录状态，页面照常显示，联网后的请求会再确认
      const offline = error instanceof ApiError && error.status === 0;
      if (requestRevision === revision.current && !(offline && initial)) updateUser(null, false);
      return offline ? initial : null;
    } finally {
      if (requestRevision === revision.current) setLoading(false);
    }
  }, [updateUser, initial]);

  useEffect(() => {
    if (initial) accountId.current = initial.id;
    void refresh();
    const onUnauthorized = () => setUser(null);
    window.addEventListener('dz:unauthorized', onUnauthorized);
    return () => window.removeEventListener('dz:unauthorized', onUnauthorized);
  }, [refresh, setUser]);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
  }, [setUser]);

  return <Ctx.Provider value={{ user, loading, refresh, setUser, logout }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);

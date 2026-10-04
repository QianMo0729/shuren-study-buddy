import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { SessionUser } from '../../shared/types';
import { api } from './api';

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const revision = useRef(0);
  const accountId = useRef<number | null | undefined>(undefined);
  const updateUser = useCallback((next: SessionUser | null) => {
    const id = next?.id ?? null;
    if (accountId.current !== undefined && accountId.current !== id) window.dispatchEvent(new CustomEvent(ACCOUNT_CHANGED));
    accountId.current = id;
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
    } catch {
      if (requestRevision === revision.current) updateUser(null);
      return null;
    } finally {
      if (requestRevision === revision.current) setLoading(false);
    }
  }, [updateUser]);

  useEffect(() => {
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

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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, updateUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);
  const revision = useRef(0);

  const setUser = useCallback((next: SessionUser | null) => {
    revision.current += 1;
    updateUser(next);
    setLoading(false);
  }, []);

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
  }, []);

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

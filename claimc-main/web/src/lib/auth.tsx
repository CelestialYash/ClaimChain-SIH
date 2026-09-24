import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setAuthToken, type AuthUser } from '../lib/api';

/**
 * Client auth state (INSURER_AUTH_DB_SECURITY_PLAN.md §2 frontend):
 * token + user persisted in localStorage; api.ts attaches the Bearer header
 * to every request. /login is the only place a token is minted.
 */

const STORAGE_KEY = 'claimchain.auth';

interface AuthState {
  token: string;
  user: AuthUser;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readStored(): AuthState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthState;
    return parsed.token && parsed.user ? parsed : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState | null>(readStored);

  // Keep api.ts's Authorization header in sync with stored state.
  useEffect(() => {
    setAuthToken(state?.token ?? null);
  }, [state]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login(email, password);
    const next: AuthState = { token: res.token, user: res.user };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    setState(next);
    return res.user;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY);
    setState(null);
    void api.logout().catch(() => undefined);
  }, []);

  const value = useMemo(
    () => ({ user: state?.user ?? null, token: state?.token ?? null, login, logout }),
    [state, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, setUnauthorizedHandler, tokenStore, type User } from './api';

interface AuthState {
  user: User | null;
  loading: boolean;
  /** Guarda o JWT e o usuário depois do login. */
  signIn: (token: string, user: User) => void;
  signOut: () => void;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const signOut = useCallback(() => {
    tokenStore.clear();
    setUser(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(signOut); // token expirado/inválido → volta ao login
    if (!tokenStore.get()) return setLoading(false);
    api
      .me()
      .then((r) => setUser(r.user))
      .catch(() => undefined) // 401 já limpa o token; erro de rede mantém o token para a próxima tentativa
      .finally(() => setLoading(false));
  }, [signOut]);

  const signIn = useCallback((token: string, u: User) => {
    tokenStore.set(token);
    setUser(u);
  }, []);

  const value = useMemo(() => ({ user, loading, signIn, signOut }), [user, loading, signIn, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth fora do AuthProvider');
  return v;
}

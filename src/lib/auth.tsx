import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

interface AuthState {
  session: Session | null;
  loading: boolean;
  /** Admin da PLATAFORMA (curadoria), não de organização (D007). */
  isPlatformAdmin: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      queryClient.clear(); // troca de usuário não pode reaproveitar cache de outro
    });
    return () => data.subscription.unsubscribe();
  }, [queryClient]);

  const userId = session?.user.id;
  const adminQuery = useQuery({
    queryKey: ['platform-admin', userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('platform_admins')
        .select('user_id')
        .eq('user_id', userId!)
        .maybeSingle();
      if (error) throw error;
      return !!data;
    },
  });

  const value: AuthState = {
    session,
    loading: loading || (!!userId && adminQuery.isLoading),
    isPlatformAdmin: adminQuery.data ?? false,
    signOut: async () => {
      await supabase.auth.signOut();
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components -- hook do próprio provider
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fora do AuthProvider');
  return ctx;
}

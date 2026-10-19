import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import type { BrokerRecord, Membership, Profile } from './identity';

interface Me {
  profile: Profile | null;
  isPlatformAdmin: boolean;
  broker: BrokerRecord | null;
  memberships: Membership[];
}

interface AuthState extends Me {
  session: Session | null;
  loading: boolean;
  /** Conta aprovada pela curadoria (ou admin da plataforma). A regra real está no banco (is_approved). */
  isApproved: boolean;
  /** Conta aprovada + CRECI conferido e ativo: pode cadastrar áreas (is_approved_broker no banco). */
  isApprovedBroker: boolean;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

const EMPTY: Me = { profile: null, isPlatformAdmin: false, broker: null, memberships: [] };

async function fetchMe(userId: string): Promise<Me> {
  const [profile, admin, broker, memberships] = await Promise.all([
    supabase
      .from('profiles')
      .select(
        'user_id, full_name, phone, account_status, signup_kind, preferred_channel, whatsapp_opt_in, review_note',
      )
      .eq('user_id', userId)
      .maybeSingle(),
    supabase.from('platform_admins').select('user_id').eq('user_id', userId).maybeSingle(),
    supabase
      .from('brokers')
      .select(
        'creci_number, creci_state, creci_type, creci_status, brokerage_org_id, next_review_at, verification_status, document_path, rejection_reason',
      )
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('organization_members')
      .select('organization_id, role, organization:organizations(id, name, type, active)')
      .eq('user_id', userId),
  ]);
  for (const r of [profile, admin, broker, memberships]) if (r.error) throw r.error;
  return {
    profile: profile.data as Profile | null,
    isPlatformAdmin: !!admin.data,
    broker: broker.data as BrokerRecord | null,
    // Organização invisível (RLS) não deve virar linha quebrada na tela.
    memberships: ((memberships.data ?? []) as unknown as Membership[]).filter(
      (m) => m.organization,
    ),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      // Troca de usuário não pode reaproveitar cache de outro (renovação de token pode).
      if (event !== 'TOKEN_REFRESHED' && event !== 'USER_UPDATED') queryClient.clear();
    });
    return () => data.subscription.unsubscribe();
  }, [queryClient]);

  const userId = session?.user.id;
  const meQuery = useQuery({
    queryKey: ['me', userId],
    enabled: !!userId,
    queryFn: () => fetchMe(userId!),
  });

  const me = meQuery.data ?? EMPTY;
  const isApproved = me.isPlatformAdmin || me.profile?.account_status === 'approved';
  const value: AuthState = {
    ...me,
    session,
    loading: loading || (!!userId && meQuery.isLoading),
    isApproved,
    isApprovedBroker:
      isApproved &&
      me.broker?.verification_status === 'approved' &&
      me.broker.creci_status === 'active',
    refresh: async () => {
      await queryClient.invalidateQueries({ queryKey: ['me'] });
    },
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

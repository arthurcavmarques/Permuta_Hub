import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { t } from '@/i18n/pt-BR';

export function FullPageMessage({ title, body }: { title: string; body?: string }) {
  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      <h1 className="text-lg font-semibold text-primary">{title}</h1>
      {body && <p className="mt-2 text-sm text-muted">{body}</p>}
    </div>
  );
}

/** A proteção real está no banco (RLS); isto só evita mostrar telas vazias. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageMessage title={t.common.loading} />;
  if (!session)
    return <Navigate to="/entrar" replace state={{ from: location.pathname + location.search }} />;
  return <>{children}</>;
}

import { Link, NavLink, Outlet } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { PRODUCT_NAME } from '@/config/product';
import { t } from '@/i18n/pt-BR';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';

export function Wordmark({ className = '' }: { className?: string }) {
  // Logo provisório: só o nome (o designer entrega o definitivo).
  return (
    <span className={`inline-flex items-center gap-2 font-semibold tracking-tight ${className}`}>
      <span aria-hidden className="h-4 w-1 rounded-full bg-accent" />
      {PRODUCT_NAME}
    </span>
  );
}

const navClass = ({ isActive }: { isActive: boolean }) =>
  isActive ? 'text-primary-foreground' : 'text-primary-foreground/70 hover:text-primary-foreground';

export function AppShell() {
  const { session, signOut, isApproved, isApprovedBroker, isPlatformAdmin } = useAuth();
  type NavItem = { to: string; label: string; end?: boolean };
  const links: NavItem[] = [];
  if (isApproved) links.push({ to: '/oportunidades', label: t.nav.opportunities, end: true });
  if (isApprovedBroker) links.push({ to: '/areas/nova', label: t.nav.newArea });
  if (isPlatformAdmin) links.push({ to: '/admin', label: t.nav.admin });
  links.push({ to: '/conta', label: t.nav.account });
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 bg-primary text-primary-foreground print:hidden">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:gap-6">
          <Link to={isApproved ? '/oportunidades' : '/conta'} className="shrink-0 text-lg">
            <Wordmark />
          </Link>
          <nav className="flex gap-4 overflow-x-auto whitespace-nowrap text-sm">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={navClass}>
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="hidden text-primary-foreground/70 sm:inline">
              {session?.user.email}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={signOut}
              className="text-primary-foreground hover:bg-primary-foreground/10"
              aria-label={t.common.signOut}
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">{t.common.signOut}</span>
            </Button>
          </div>
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
    </div>
  );
}

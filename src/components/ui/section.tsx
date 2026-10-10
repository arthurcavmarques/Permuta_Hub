import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const toneClass: Record<Tone, string> = {
  neutral: 'bg-neutral-bg text-neutral',
  info: 'bg-info-bg text-info',
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning',
  danger: 'bg-danger-bg text-danger',
};

export function Badge({
  tone = 'neutral',
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        toneClass[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Notice({
  tone = 'info',
  title,
  children,
  className,
}: {
  tone?: Tone;
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div role="status" className={cn('rounded-md px-4 py-3 text-sm', toneClass[tone], className)}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={cn(title && 'mt-1')}>{children}</div>}
    </div>
  );
}

/** Bloco com título para páginas de formulário (conta, organização). */
export function Section({
  title,
  description,
  aside,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-surface p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-primary">{title}</h2>
          {description && <p className="mt-1 text-sm text-muted">{description}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="text-xs text-danger">{message}</p>;
}

export function FormAlert({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
      {message}
    </p>
  );
}

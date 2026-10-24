import type { PropsWithChildren, ReactNode } from 'react';

export function Panel({
  title,
  actions,
  children,
}: PropsWithChildren<{ title: string; actions?: ReactNode }>) {
  return (
    <section className="panel">
      <div className="panel-header">
        <h2>{title}</h2>
        {actions ? <div className="panel-actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function StatusBadge({ tone, children }: PropsWithChildren<{ tone: 'ok' | 'warn' | 'muted' | 'error' }>) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function ErrorCallout({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }

  return <div className="callout callout-error">{message}</div>;
}

export function SuccessCallout({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }

  return <div className="callout callout-success">{message}</div>;
}

export function LoadingBlock({ label = 'Chargement...' }: { label?: string }) {
  return <div className="loading-block">{label}</div>;
}

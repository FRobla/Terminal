import type { ReactNode } from "react";

/** Skeleton rows plus the operation in progress; never an endless generic spinner. */
export function LoadingState(props: { operation: string; rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="space-y-1.5">
      <p className="text-[12px] text-text-secondary">{props.operation}</p>
      {Array.from({ length: props.rows ?? 3 }, (_, index) => (
        <div key={index} className="h-5 animate-pulse rounded-sm bg-surface-2" aria-hidden="true" />
      ))}
    </div>
  );
}

export function EmptyState(props: { children: ReactNode }) {
  return <p className="py-2 text-[12px] text-text-secondary">{props.children}</p>;
}

export function ErrorState(props: {
  title: string;
  children?: ReactNode;
  requestId?: string | undefined;
  action?: ReactNode;
}) {
  return (
    <div
      role="alert"
      className="rounded-[var(--radius-panel)] border border-negative/50 bg-negative/5 px-3 py-2 text-[12px]"
    >
      <p className="font-semibold text-negative">{props.title}</p>
      {props.children ? <div className="mt-1 text-text-primary">{props.children}</div> : null}
      {props.requestId ? (
        <p className="mt-1 font-mono text-[11px] text-text-muted">Request ID: {props.requestId}</p>
      ) : null}
      {props.action ? <div className="mt-2">{props.action}</div> : null}
    </div>
  );
}

export function CriticalBanner(props: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="border-b border-critical/60 bg-critical-bg px-4 py-2 text-[12px] font-medium text-critical"
    >
      {props.children}
    </div>
  );
}

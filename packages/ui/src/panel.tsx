import type { ReactNode } from "react";

export function Panel(props: {
  title: string;
  actions?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  headingLevel?: 2 | 3;
  "aria-busy"?: boolean;
}) {
  const Heading = props.headingLevel === 3 ? "h3" : "h2";
  return (
    <section
      className="flex min-w-0 flex-col rounded-[var(--radius-panel)] border border-border bg-surface-1"
      aria-busy={props["aria-busy"]}
    >
      <header className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <Heading className="text-[11px] font-semibold tracking-wider text-text-secondary uppercase">
          {props.title}
        </Heading>
        {props.actions ? <div className="flex items-center gap-2">{props.actions}</div> : null}
      </header>
      <div className="min-w-0 p-3">{props.children}</div>
      {props.footer ? (
        <footer className="border-t border-border px-3 py-1.5 text-[11px] text-text-muted">
          {props.footer}
        </footer>
      ) : null}
    </section>
  );
}

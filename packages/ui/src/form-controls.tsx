import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

const CONTROL =
  "w-full rounded-[var(--radius-panel)] border border-border-strong bg-bg px-2 text-[12px] text-text-primary disabled:opacity-50 aria-[invalid=true]:border-negative";

export function TextInput({ className = "", ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`h-7 ${CONTROL} ${className}`} {...props} />;
}

export function TextArea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`py-1 ${CONTROL} ${className}`} {...props} />;
}

export function Select({ className = "", ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`h-7 ${CONTROL} ${className}`} {...props} />;
}

/** A labeled form row: label, control, and optional help text tied to the control. */
export function FormField(props: { id: string; label: string; help?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[200px_1fr] sm:items-start sm:gap-3">
      <label htmlFor={props.id} className="pt-1 text-[12px] text-text-secondary">
        {props.label}
      </label>
      <div className="min-w-0 space-y-1">
        {props.children}
        {props.help ? (
          <p id={`${props.id}-help`} className="text-[11px] text-text-muted">
            {props.help}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Polite status line after a save ("Saved", or an error). */
export function SaveStatus(props: {
  state: "idle" | "saving" | "saved" | "error";
  error?: string | undefined;
}) {
  return (
    <p role="status" aria-live="polite" className="text-[11px]">
      {props.state === "saved" ? <span className="text-positive">Saved</span> : null}
      {props.state === "saving" ? <span className="text-text-secondary">Saving…</span> : null}
      {props.state === "error" ? (
        <span className="text-negative">{props.error ?? "Could not save."}</span>
      ) : null}
    </p>
  );
}

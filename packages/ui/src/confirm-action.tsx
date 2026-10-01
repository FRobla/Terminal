"use client";

import { useState } from "react";
import { Button } from "./button";

/**
 * A sensitive action that needs an explicit second step. The consequence is stated
 * before the user confirms (SPEC-026 §6).
 */
export function ConfirmAction(props: {
  label: string;
  consequence: string;
  confirmLabel?: string;
  onConfirm: () => void;
  pending?: boolean;
  disabled?: boolean;
  variant?: "danger" | "default";
}) {
  const [confirming, setConfirming] = useState(false);
  const variant = props.variant ?? "danger";
  if (!confirming) {
    return (
      <Button
        variant={variant}
        onClick={() => setConfirming(true)}
        disabled={props.disabled || props.pending}
      >
        {props.pending ? "Working…" : props.label}
      </Button>
    );
  }
  return (
    <span
      role="group"
      aria-label={`Confirm: ${props.label}`}
      className="inline-flex flex-wrap items-center gap-2"
    >
      <span className="text-[11px] text-warning">{props.consequence}</span>
      <Button
        variant={variant}
        onClick={() => {
          setConfirming(false);
          props.onConfirm();
        }}
      >
        {props.confirmLabel ?? `Confirm ${props.label.toLowerCase()}`}
      </Button>
      <Button variant="ghost" onClick={() => setConfirming(false)}>
        Cancel
      </Button>
    </span>
  );
}

"use client";

import { useState } from "react";
import { useDisplaySettings } from "./display-settings";

export function truncateMiddle(value: string, visible = 4): string {
  return value.length <= visible * 2 + 1 ? value : `${value.slice(0, visible)}…${value.slice(-visible)}`;
}

/**
 * Address or signature display: middle-truncated (or full, per the user's address
 * display preference) with the full value for assistive technology and on hover, plus
 * copy and optional explorer link. Use `full` in confirmations, where truncation is
 * not allowed.
 */
export function AddressText(props: {
  value: string;
  href?: string | undefined;
  full?: boolean | undefined;
  label?: string | undefined;
}) {
  const [copied, setCopied] = useState(false);
  const display = useDisplaySettings();
  const full = props.full ?? display.addressDisplay === "full";
  const shown = full ? props.value : truncateMiddle(props.value);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(props.value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 font-mono">
      {props.href ? (
        <a
          href={props.href}
          target="_blank"
          rel="noopener noreferrer external"
          title={props.value}
          aria-label={`${props.label ?? "Address"} ${props.value} (opens ${display.explorerName})`}
          className="break-all text-text-primary underline decoration-border-strong underline-offset-2 hover:decoration-text-primary"
        >
          {shown}
        </a>
      ) : (
        <span
          title={props.value}
          aria-label={`${props.label ?? "Address"} ${props.value}`}
          className="break-all"
        >
          {shown}
        </span>
      )}
      <button
        type="button"
        onClick={copy}
        className="text-[11px] text-text-muted hover:text-text-primary"
        aria-label={`Copy ${props.label ?? "address"}`}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}

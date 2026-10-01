import type { ProviderStatus } from "@sct/validation";

const STATUS_CLASS: Record<ProviderStatus, string> = {
  HEALTHY: "text-positive",
  DEGRADED: "text-warning",
  RATE_LIMITED: "text-warning",
  UNAVAILABLE: "text-negative",
  DISABLED: "text-text-muted",
  UNKNOWN: "text-text-muted",
};

/** Status always carries text, never color alone. */
export function ProviderStatusText(props: { status: ProviderStatus }) {
  return (
    <span className={`font-mono text-[11px] font-semibold ${STATUS_CLASS[props.status]}`}>
      {props.status}
    </span>
  );
}

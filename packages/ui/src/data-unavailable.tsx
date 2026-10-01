import type { UnavailableInfo } from "@sct/validation";
import { Button } from "./button";
import { Timestamp } from "./display-settings";
import { formatAge } from "./freshness";

const REASON_LABELS: Record<UnavailableInfo["reason"], string> = {
  RPC_UNAVAILABLE: "RPC unavailable",
  RPC_TIMEOUT: "RPC timeout",
  RPC_RATE_LIMITED: "RPC rate limited",
  RPC_INVALID_RESPONSE: "Invalid RPC response",
  PROVIDER_UNAVAILABLE: "Provider unavailable",
  PROVIDER_RATE_LIMITED: "Provider rate limited",
  PROVIDER_NOT_CONFIGURED: "Provider not configured",
  NOT_SUPPORTED_ON_NETWORK: "Not available on this network",
  CLUSTER_UNVERIFIED: "Cluster unverified",
  DEPENDENCY_UNAVAILABLE: "Required input unavailable",
};

/** PRV-AC-07 — explicit unavailable state: reason, source, last success, retry state. */
export function DataUnavailable(props: { info: UnavailableInfo; onRetry?: () => void; retrying?: boolean }) {
  const { info } = props;
  const lastSuccess = info.lastSuccessfulRetrievalAt;
  return (
    <div
      role="status"
      className="rounded-[var(--radius-panel)] border border-warning/50 bg-warning/5 px-3 py-2 text-[12px]"
    >
      <p className="font-mono text-[11px] font-semibold tracking-wider text-warning">DATA UNAVAILABLE</p>
      <p className="mt-1 text-text-primary">{info.message}</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-text-secondary">
        <dt>Reason</dt>
        <dd className="font-mono">{REASON_LABELS[info.reason]}</dd>
        <dt>Source</dt>
        <dd className="font-mono">{info.source}</dd>
        <dt>Last successful retrieval</dt>
        <dd className="font-mono">{lastSuccess ? <Timestamp value={lastSuccess} /> : "Never"}</dd>
        <dt>Retry</dt>
        <dd>
          {info.retry.retryable
            ? `Retryable${info.retry.retryAfterMs !== undefined ? ` after ${formatAge(info.retry.retryAfterMs)}` : ""} · ${info.retry.attempts} attempt(s) made`
            : `Not retryable · ${info.retry.attempts} attempt(s) made`}
        </dd>
      </dl>
      {props.onRetry && info.retry.retryable ? (
        <Button className="mt-2" onClick={props.onRetry} disabled={props.retrying}>
          {props.retrying ? "Retrying…" : "Retry"}
        </Button>
      ) : null}
    </div>
  );
}

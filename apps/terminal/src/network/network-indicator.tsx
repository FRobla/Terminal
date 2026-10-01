import { networkLabel } from "@sct/network";
import { publicConfig } from "../platform/public-config";

/** NET-AC-05 — permanent, non-dismissible network indicator. */
export function NetworkIndicator() {
  const label = networkLabel(publicConfig.NEXT_PUBLIC_SOLANA_CLUSTER);
  return (
    <span
      role="status"
      aria-label={`Active network: ${label}`}
      data-testid="network-indicator"
      className="inline-flex h-6 items-center rounded-[var(--radius-panel)] border border-network-devnet/60 bg-network-devnet-bg px-2 font-mono text-[11px] font-semibold tracking-wider text-network-devnet"
    >
      {label}
    </span>
  );
}

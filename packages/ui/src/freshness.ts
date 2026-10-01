/** Relative duration text used in freshness labels ("12 s", "4m 17s", "2h 5m"). */
export function formatAge(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export type Freshness = { state: "fresh" | "stale"; ageMs: number; label: string };

/** WO-AC-07: fresh until the threshold, then "Stale — last update … ago". */
export function describeFreshness(retrievedAt: string, now: number, staleAfterMs: number): Freshness {
  const ageMs = Math.max(0, now - Date.parse(retrievedAt));
  if (ageMs > staleAfterMs) {
    return { state: "stale", ageMs, label: `Stale — last update ${formatAge(ageMs)} ago` };
  }
  return { state: "fresh", ageMs, label: `Updated ${formatAge(ageMs)} ago` };
}

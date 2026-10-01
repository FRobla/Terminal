/** WO-AC-16: automatic refresh is never faster than this. */
export const MIN_OVERVIEW_REFRESH_INTERVAL_MS = 30_000;

/** SET-AC-06: the user's refresh interval, clamped to the WO-AC-16 floor; `false` when off. */
export function overviewRefreshInterval(refreshSeconds: number): number | false {
  return refreshSeconds === 0 ? false : Math.max(MIN_OVERVIEW_REFRESH_INTERVAL_MS, refreshSeconds * 1000);
}

export type TimeZoneMode = "local" | "utc";

/**
 * Absolute timestamp as `YYYY-MM-DD HH:mm:ss <zone>` in the browser's zone or UTC
 * (SET-AC-06). The zone label is always shown so a time is never ambiguous.
 */
export function formatTimestamp(iso: string, mode: TimeZoneMode): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Invalid time";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: mode === "utc" ? "UTC" : undefined,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}:${part("second")} ${part("timeZoneName")}`;
}

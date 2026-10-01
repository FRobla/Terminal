"use client";

import type { Announcement } from "@sct/validation";
import { useCurrentAnnouncement } from "./use-announcement";

const SEVERITY = {
  info: {
    label: "NOTICE",
    className: "border-active/50 bg-active/10 text-text-primary",
    labelClass: "text-active",
  },
  warning: {
    label: "WARNING",
    className: "border-warning/60 bg-warning/10 text-text-primary",
    labelClass: "text-warning",
  },
  critical: {
    label: "CRITICAL",
    className: "border-critical/60 bg-critical-bg text-critical",
    labelClass: "text-critical",
  },
} as const satisfies Record<
  Announcement["severity"],
  { label: string; className: string; labelClass: string }
>;

export function AnnouncementBannerView(props: { announcement: Pick<Announcement, "severity" | "message"> }) {
  const style = SEVERITY[props.announcement.severity];
  return (
    <div
      role={props.announcement.severity === "critical" ? "alert" : "status"}
      className={`flex gap-2 border-b px-3 py-1.5 text-[12px] ${style.className}`}
      data-testid="announcement-banner"
    >
      <span className={`font-mono text-[11px] font-semibold tracking-wider ${style.labelClass}`}>
        {style.label}
      </span>
      {/* Owner-supplied text, rendered as plain text only (OWN-AC-11). */}
      <span className="min-w-0 break-words">{props.announcement.message}</span>
    </div>
  );
}

/** OWN-AC-11 — the owner's platform-wide announcement, for every signed-in user. */
export function AnnouncementBanner() {
  const announcement = useCurrentAnnouncement();
  if (!announcement.data?.enabled) return null;
  return <AnnouncementBannerView announcement={announcement.data} />;
}

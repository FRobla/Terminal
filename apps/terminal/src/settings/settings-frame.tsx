"use client";

import { LoadingState, Panel } from "@sct/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useSession } from "../auth/use-session";

const PERSONAL_SECTIONS = [
  { href: "/settings/profile", label: "Profile" },
  { href: "/settings/preferences", label: "Preferences" },
  { href: "/settings/sessions", label: "Sessions" },
] as const;

/** SPEC-026 — visible only with platform.administer; the API enforces it on every route. */
const CONSOLE_SECTIONS = [
  { href: "/settings/console/overview", label: "Overview" },
  { href: "/settings/console/members", label: "Members" },
  { href: "/settings/console/sessions", label: "Sessions" },
  { href: "/settings/console/audit", label: "Audit log" },
  { href: "/settings/console/organization", label: "Organization" },
  { href: "/settings/console/announcement", label: "Announcement" },
  { href: "/settings/console/system", label: "System" },
  { href: "/settings/console/jobs", label: "Jobs" },
  { href: "/settings/console/developer", label: "Developer" },
] as const;

function SectionLinks(props: { title: string; sections: ReadonlyArray<{ href: string; label: string }> }) {
  const pathname = usePathname();
  return (
    <div>
      <p className="px-2 pb-1 text-[11px] font-semibold tracking-wider text-text-muted uppercase">
        {props.title}
      </p>
      <ul className="flex flex-wrap gap-x-1 md:flex-col">
        {props.sections.map((section) => {
          const active = pathname === section.href;
          return (
            <li key={section.href}>
              <Link
                href={section.href}
                aria-current={active ? "page" : undefined}
                className={`block rounded-[var(--radius-panel)] px-2 py-1 text-[12px] ${active ? "bg-surface-2 text-text-primary" : "text-text-secondary hover:text-text-primary"}`}
              >
                {section.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** SET-AC-01 — Settings frame: personal sections for everyone, the owner console for the owner. */
export function SettingsFrame(props: { children: ReactNode }) {
  const { session, can, isPending } = useSession();

  if (isPending) return <LoadingState operation="Reading your session…" rows={2} />;
  if (!session) {
    return (
      <Panel title="Settings">
        <p className="text-[12px] text-text-secondary">
          Sign in to manage your settings. Use the connect button in the status bar.
        </p>
      </Panel>
    );
  }

  const owner = can("platform.administer");
  return (
    <div className="grid gap-3 md:grid-cols-[180px_1fr]">
      <nav aria-label="Settings" className="space-y-3">
        <SectionLinks title="Personal" sections={PERSONAL_SECTIONS} />
        {owner ? <SectionLinks title="Owner console" sections={CONSOLE_SECTIONS} /> : null}
      </nav>
      <div className="min-w-0">{props.children}</div>
    </div>
  );
}

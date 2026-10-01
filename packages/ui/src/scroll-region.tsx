import type { ReactNode } from "react";

/**
 * A scrollable container that keyboard users can focus and scroll (WCAG 2.1.1,
 * axe `scrollable-region-focusable`). The label names the region for screen readers.
 */
export function ScrollRegion(props: { label: string; className?: string; children: ReactNode }) {
  return (
    <div role="region" aria-label={props.label} tabIndex={0} className={props.className ?? "overflow-x-auto"}>
      {props.children}
    </div>
  );
}

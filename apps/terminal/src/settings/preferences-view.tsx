"use client";

import { EXPLORER_NAMES, EXPLORERS, type Explorer } from "@sct/network";
import { Button, ErrorState, FormField, LoadingState, Panel, SaveStatus, Select } from "@sct/ui";
import { DEFAULT_USER_PREFERENCES, OVERVIEW_REFRESH_OPTIONS, type UserPreferences } from "@sct/validation";
import { useState, type FormEvent } from "react";
import { ApiRequestError } from "../platform/api-client";
import { usePreferencesState, useSavePreferences } from "../preferences/preferences-provider";

function Toggle(props: {
  id: string;
  label: string;
  help: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <FormField id={props.id} label={props.label} help={props.help}>
      <input
        id={props.id}
        type="checkbox"
        checked={props.checked}
        onChange={(event) => props.onChange(event.target.checked)}
        aria-describedby={`${props.id}-help`}
        className="mt-1.5 h-4 w-4 accent-[var(--color-active)]"
      />
    </FormField>
  );
}

const REFRESH_LABELS: Record<(typeof OVERVIEW_REFRESH_OPTIONS)[number], string> = {
  0: "Off (manual refresh only)",
  30: "Every 30 seconds",
  60: "Every minute",
  120: "Every 2 minutes",
};

/** SET-AC-04, SET-AC-06 — every option here changes real terminal behavior. */
export function PreferencesView() {
  const state = usePreferencesState();
  if (state.error) {
    const error = state.error instanceof ApiRequestError ? state.error : null;
    return (
      <ErrorState title="Your preferences could not be loaded." requestId={error?.requestId}>
        {error?.message}
      </ErrorState>
    );
  }
  if (!state.loaded) return <LoadingState operation="Loading your preferences…" rows={6} />;
  return <PreferencesForm saved={state.preferences} />;
}

function PreferencesForm(props: { saved: UserPreferences }) {
  const saved = props.saved;
  const [draft, setDraft] = useState<UserPreferences>(saved);
  const save = useSavePreferences();
  const set = <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate(draft);
  };
  const apiError = save.error instanceof ApiRequestError ? save.error.message : undefined;

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <h1 className="text-[13px] font-semibold">Preferences</h1>
      <p className="text-[12px] text-text-secondary">
        Saved to your account, so they apply on every device you sign in from.
      </p>

      <Panel title="Display">
        <div className="space-y-3">
          <FormField
            id="pref-time-zone"
            label="Time zone"
            help="Applies to block times, data retrieval times, sessions, and console tables. The zone is always labeled."
          >
            <Select
              id="pref-time-zone"
              value={draft.timeZone}
              onChange={(event) => set("timeZone", event.target.value as UserPreferences["timeZone"])}
              aria-describedby="pref-time-zone-help"
            >
              <option value="local">Browser time zone</option>
              <option value="utc">UTC</option>
            </Select>
          </FormField>
          <FormField id="pref-density" label="Density" help="Row spacing and text size of the terminal.">
            <Select
              id="pref-density"
              value={draft.density}
              onChange={(event) => set("density", event.target.value as UserPreferences["density"])}
              aria-describedby="pref-density-help"
            >
              <option value="compact">Compact</option>
              <option value="comfortable">Comfortable</option>
            </Select>
          </FormField>
          <FormField
            id="pref-address-display"
            label="Addresses and signatures"
            help="Full values are never hidden: they are always available on hover, to screen readers, and through Copy."
          >
            <Select
              id="pref-address-display"
              value={draft.addressDisplay}
              onChange={(event) =>
                set("addressDisplay", event.target.value as UserPreferences["addressDisplay"])
              }
              aria-describedby="pref-address-display-help"
            >
              <option value="short">Shortened (first and last 4 characters)</option>
              <option value="full">Full</option>
            </Select>
          </FormField>
          <Toggle
            id="pref-reduce-motion"
            label="Reduce motion"
            help="Turns off loading animations and transitions, in addition to your operating system setting."
            checked={draft.reduceMotion}
            onChange={(value) => set("reduceMotion", value)}
          />
        </div>
      </Panel>

      <Panel title="Behavior">
        <div className="space-y-3">
          <FormField
            id="pref-explorer"
            label="Block explorer"
            help="Address and transaction links open here, always on the terminal's cluster."
          >
            <Select
              id="pref-explorer"
              value={draft.explorer}
              onChange={(event) => set("explorer", event.target.value as Explorer)}
              aria-describedby="pref-explorer-help"
            >
              {EXPLORERS.map((explorer) => (
                <option key={explorer} value={explorer}>
                  {EXPLORER_NAMES[explorer]}
                </option>
              ))}
            </Select>
          </FormField>
          <FormField
            id="pref-refresh"
            label="Wallet Overview auto-refresh"
            help="Never faster than every 30 seconds, to respect the public Devnet RPC limits. Refresh is paused while the tab is hidden."
          >
            <Select
              id="pref-refresh"
              value={String(draft.overviewRefreshSeconds)}
              onChange={(event) =>
                set(
                  "overviewRefreshSeconds",
                  Number(event.target.value) as UserPreferences["overviewRefreshSeconds"],
                )
              }
              aria-describedby="pref-refresh-help"
            >
              {OVERVIEW_REFRESH_OPTIONS.map((seconds) => (
                <option key={seconds} value={seconds}>
                  {REFRESH_LABELS[seconds]}
                </option>
              ))}
            </Select>
          </FormField>
          <Toggle
            id="pref-shortcuts"
            label="Keyboard shortcuts"
            help="/ focuses the address search and R refreshes the Wallet Overview."
            checked={draft.keyboardShortcuts}
            onChange={(value) => set("keyboardShortcuts", value)}
          />
        </div>
      </Panel>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={!dirty || save.isPending}>
          {save.isPending ? "Saving…" : "Save preferences"}
        </Button>
        <Button variant="ghost" onClick={() => setDraft(DEFAULT_USER_PREFERENCES)} disabled={save.isPending}>
          Restore defaults
        </Button>
        {dirty && !save.isPending ? <span className="text-[11px] text-warning">Unsaved changes</span> : null}
        <SaveStatus
          state={
            save.isPending ? "saving" : save.isError ? "error" : save.isSuccess && !dirty ? "saved" : "idle"
          }
          error={apiError}
        />
      </div>
    </form>
  );
}

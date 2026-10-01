"use client";

import { Button, FormField, LoadingState, Panel, SaveStatus, Select, TextArea, Timestamp } from "@sct/ui";
import {
  ANNOUNCEMENT_SEVERITIES,
  announcementInputSchema,
  type Announcement,
  type AnnouncementInput,
} from "@sct/validation";
import { useState, type FormEvent } from "react";
import { AnnouncementBannerView } from "../announcements/announcement-banner";
import { useCurrentAnnouncement, useSaveAnnouncement } from "../announcements/use-announcement";
import { ApiRequestError } from "../platform/api-client";
import { OwnerOnly, RequestFailed } from "./owner-only";

const MESSAGE_LIMIT = 500;

function Editor(props: { current: Announcement | null }) {
  const [draft, setDraft] = useState<AnnouncementInput>({
    enabled: props.current?.enabled ?? true,
    severity: props.current?.severity ?? "info",
    message: props.current?.message ?? "",
  });
  const [error, setError] = useState<string | null>(null);
  const save = useSaveAnnouncement();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const parsed = announcementInputSchema.safeParse(draft);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid announcement");
      return;
    }
    setError(null);
    save.mutate(parsed.data);
  };
  const apiError = save.error instanceof ApiRequestError ? save.error.message : undefined;

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <FormField
        id="announcement-message"
        label="Message"
        help={`${draft.message.length}/${MESSAGE_LIMIT} characters. Plain text, one paragraph.`}
      >
        <TextArea
          id="announcement-message"
          rows={3}
          maxLength={MESSAGE_LIMIT}
          value={draft.message}
          aria-invalid={error !== null}
          aria-describedby="announcement-message-help"
          onChange={(event) => setDraft({ ...draft, message: event.target.value.replace(/[\r\n]+/g, " ") })}
        />
        {error ? <p className="text-[11px] text-negative">{error}</p> : null}
      </FormField>
      <FormField id="announcement-severity" label="Severity">
        <Select
          id="announcement-severity"
          value={draft.severity}
          onChange={(event) =>
            setDraft({ ...draft, severity: event.target.value as AnnouncementInput["severity"] })
          }
        >
          {ANNOUNCEMENT_SEVERITIES.map((severity) => (
            <option key={severity} value={severity}>
              {severity[0]?.toUpperCase()}
              {severity.slice(1)}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField
        id="announcement-enabled"
        label="Show to all users"
        help="Signed-in users see the banner below the status bar."
      >
        <input
          id="announcement-enabled"
          type="checkbox"
          checked={draft.enabled}
          onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
          aria-describedby="announcement-enabled-help"
          className="mt-1.5 h-4 w-4 accent-[var(--color-active)]"
        />
      </FormField>
      {draft.message.trim() ? (
        <div>
          <p className="mb-1 text-[11px] tracking-wider text-text-muted uppercase">Preview</p>
          <div className="rounded-[var(--radius-panel)] border border-border">
            <AnnouncementBannerView
              announcement={{ severity: draft.severity, message: draft.message.trim() }}
            />
          </div>
        </div>
      ) : null}
      <div className="flex items-center gap-3">
        <Button type="submit" variant="primary" disabled={save.isPending}>
          {save.isPending ? "Publishing…" : draft.enabled ? "Publish announcement" : "Save (hidden)"}
        </Button>
        <SaveStatus
          state={save.isPending ? "saving" : save.isError ? "error" : save.isSuccess ? "saved" : "idle"}
          error={apiError}
        />
      </div>
    </form>
  );
}

/** OWN-AC-11 */
export function AnnouncementEditor() {
  const current = useCurrentAnnouncement();
  return (
    <OwnerOnly title="Announcement">
      <Panel title="Platform announcement">
        {current.isPending ? (
          <LoadingState operation="Reading the current announcement…" rows={3} />
        ) : current.isError ? (
          <RequestFailed title="The announcement could not be loaded." error={current.error} />
        ) : (
          <>
            {current.data ? (
              <p className="mb-3 text-[11px] text-text-secondary">
                {current.data.enabled ? "Live" : "Hidden"} · last changed{" "}
                <Timestamp value={current.data.updatedAt} />
                {current.data.updatedBy?.displayName ? ` by ${current.data.updatedBy.displayName}` : ""}
              </p>
            ) : (
              <p className="mb-3 text-[11px] text-text-secondary">No announcement has been published.</p>
            )}
            <Editor current={current.data} />
          </>
        )}
      </Panel>
    </OwnerOnly>
  );
}

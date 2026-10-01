"use client";

import { FormField, Select, TextArea, TextInput } from "@sct/ui";
import { WALLET_CATEGORIES, type WalletCategory } from "@sct/validation";
import { CATEGORY_LABELS } from "./registry-labels";

export interface WalletMetadataDraft {
  label: string;
  category: WalletCategory;
  purpose: string;
  tags: string;
  notes: string;
}

export const EMPTY_METADATA: WalletMetadataDraft = {
  label: "",
  category: "OPERATIONS",
  purpose: "",
  tags: "",
  notes: "",
};

/** Comma- or space-separated tags as typed; the API normalizes and validates them. */
export function parseTags(input: string): string[] {
  return input
    .split(/[\s,]+/)
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
}

/** The metadata part of a registration or update request (SPEC-009 §3). */
export function metadataRequest(draft: WalletMetadataDraft) {
  return {
    label: draft.label,
    category: draft.category,
    purpose: draft.purpose.trim() === "" ? null : draft.purpose,
    tags: parseTags(draft.tags),
    notes: draft.notes.trim() === "" ? null : draft.notes,
  };
}

export function WalletMetadataFields(props: {
  idPrefix: string;
  draft: WalletMetadataDraft;
  onChange: (draft: WalletMetadataDraft) => void;
  /** Watch-only custody is the only one that may use the WATCH_ONLY category. */
  allowWatchOnlyCategory: boolean;
  disabled?: boolean;
}) {
  const { draft, idPrefix } = props;
  const set = <K extends keyof WalletMetadataDraft>(key: K, value: WalletMetadataDraft[K]) =>
    props.onChange({ ...draft, [key]: value });
  const categories = WALLET_CATEGORIES.filter(
    (category) => props.allowWatchOnlyCategory || category !== "WATCH_ONLY",
  );
  return (
    <div className="space-y-2">
      <FormField
        id={`${idPrefix}-label`}
        label="Label"
        help="1–64 characters, shown everywhere this wallet appears."
      >
        <TextInput
          id={`${idPrefix}-label`}
          value={draft.label}
          maxLength={64}
          required
          disabled={props.disabled}
          onChange={(event) => set("label", event.target.value)}
        />
      </FormField>
      <FormField id={`${idPrefix}-category`} label="Category">
        <Select
          id={`${idPrefix}-category`}
          value={draft.category}
          disabled={props.disabled}
          onChange={(event) => set("category", event.target.value as WalletCategory)}
        >
          {categories.map((category) => (
            <option key={category} value={category}>
              {CATEGORY_LABELS[category]}
            </option>
          ))}
        </Select>
      </FormField>
      <FormField id={`${idPrefix}-purpose`} label="Purpose" help="Optional, up to 200 characters.">
        <TextInput
          id={`${idPrefix}-purpose`}
          value={draft.purpose}
          maxLength={200}
          disabled={props.disabled}
          onChange={(event) => set("purpose", event.target.value)}
        />
      </FormField>
      <FormField
        id={`${idPrefix}-tags`}
        label="Tags"
        help="Up to 10, separated by commas or spaces. Letters, digits, and hyphens."
      >
        <TextInput
          id={`${idPrefix}-tags`}
          value={draft.tags}
          disabled={props.disabled}
          onChange={(event) => set("tags", event.target.value)}
        />
      </FormField>
      <FormField id={`${idPrefix}-notes`} label="Notes" help="Optional, up to 2,000 characters.">
        <TextArea
          id={`${idPrefix}-notes`}
          rows={3}
          value={draft.notes}
          maxLength={2000}
          disabled={props.disabled}
          onChange={(event) => set("notes", event.target.value)}
        />
      </FormField>
    </div>
  );
}

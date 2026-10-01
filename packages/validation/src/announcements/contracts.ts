import { z } from "zod";
import { isoTimestampSchema } from "../contract-primitives";
import { plainTextSchema } from "../plain-text";

/** SPEC-026 OWN-AC-11 — platform-wide announcement banner. */

export const ANNOUNCEMENT_SEVERITIES = ["info", "warning", "critical"] as const;

export const announcementInputSchema = z
  .object({
    enabled: z.boolean(),
    severity: z.enum(ANNOUNCEMENT_SEVERITIES),
    message: plainTextSchema({ max: 500 }),
  })
  .strict();

export type AnnouncementInput = z.infer<typeof announcementInputSchema>;

export const announcementSchema = z.object({
  enabled: z.boolean(),
  severity: z.enum(ANNOUNCEMENT_SEVERITIES),
  message: z.string(),
  updatedAt: isoTimestampSchema,
  updatedBy: z.object({ id: z.uuid(), displayName: z.string().nullable() }).nullable(),
});

export type Announcement = z.infer<typeof announcementSchema>;

/** `null` when no announcement has ever been saved. */
export const currentAnnouncementSchema = announcementSchema.nullable();

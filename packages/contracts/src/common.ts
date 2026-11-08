import { z } from "zod";
import { AVATAR_COLORS, AVATAR_EMOJIS } from "./values.js";

export const IdSchema = z.uuid();
/** Calendar date without time, `YYYY-MM-DD`. Deadlines and expiry dates are calendar dates (Europe/Paris). */
export const CalendarDateSchema = z.iso.date();
export const TimestampSchema = z.iso.datetime({ offset: true });

export const PageInputSchema = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});

export const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

/**
 * How volunteers see a person in the back-office: a first name or nickname chosen by a volunteer (never shown to the
 * person, never sent on WhatsApp), an emoji and a colour. Optional: without it the masked phone label is shown.
 */
export const AvatarSchema = z.object({
  name: z.string().trim().max(24).nullable(),
  emoji: z.enum(AVATAR_EMOJIS).nullable(),
  color: z.enum(AVATAR_COLORS).nullable(),
});
export type Avatar = z.infer<typeof AvatarSchema>;

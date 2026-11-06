import { z } from "zod";

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

import { z } from "zod";
import { CalendarDateSchema, IdSchema, TimestampSchema } from "./common.js";
import { PLACE_KINDS } from "./values.js";

/**
 * Places for today: emergency shelter, food distributions, showers… posted by volunteers (`places.manage`).
 * Public information only (no beneficiary data). The WhatsApp bot answers "where can I sleep or eat tonight" from
 * these, translated into the person's language, without a review step: the content is the volunteer's own.
 */
export const PlaceKindSchema = z.enum(PLACE_KINDS);
export type PlaceKind = z.infer<typeof PlaceKindSchema>;

/** "HH:MM", 24 h. */
export const ClockTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));

export const PlaceInputSchema = z.object({
  kind: PlaceKindSchema,
  /** French, e.g. "Distribution de repas – Restos du Cœur". */
  name: z.string().trim().min(2).max(120),
  address: optionalText(200),
  phone: optionalText(40),
  /** French: who can come, what to bring, conditions. */
  details: optionalText(500),
  /** First day it applies. */
  startsOn: CalendarDateSchema,
  /** Last day it applies; null = until removed. */
  endsOn: CalendarDateSchema.nullable().optional().transform((v) => v ?? null),
  /** ISO weekdays it is open (1 = Monday … 7 = Sunday); empty = every day between the dates. */
  weekdays: z.array(z.number().int().min(1).max(7)).max(7).default([]),
  opensAt: ClockTimeSchema.nullable().optional().transform((v) => v ?? null),
  closesAt: ClockTimeSchema.nullable().optional().transform((v) => v ?? null),
}).refine((p) => !p.endsOn || p.endsOn >= p.startsOn, { message: "endsOn before startsOn", path: ["endsOn"] });
export type PlaceInput = z.infer<typeof PlaceInputSchema>;

export const PlaceSchema = z.object({
  id: IdSchema,
  kind: PlaceKindSchema,
  name: z.string(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  details: z.string().nullable(),
  startsOn: CalendarDateSchema,
  endsOn: CalendarDateSchema.nullable(),
  weekdays: z.array(z.number().int()),
  opensAt: z.string().nullable(),
  closesAt: z.string().nullable(),
  /** Open on the requested day (today unless a date was given). */
  openToday: z.boolean(),
  updatedAt: TimestampSchema,
  updatedByName: z.string().nullable(),
});
export type Place = z.infer<typeof PlaceSchema>;

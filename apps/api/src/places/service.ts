import { DomainError } from "../errors.js";
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { PLACE_KINDS, isRtl, type LanguageCode, type Place, type PlaceInput, type PlaceKind } from "@wilson/contracts";
import { formatDate, isolate, waText } from "@wilson/i18n";
import { places, volunteers } from "../db/schema.js";
import type { Deps } from "../deps.js";
import { withUsageContext } from "../usage/context.js";
import { localDate } from "../time.js";

type Row = typeof places.$inferSelect;
type PlaceDeps = Pick<Deps, "db" | "llm" | "config" | "now">;

export const PLACE_EMOJI: Record<PlaceKind, string> = { shelter: "🛏️", food: "🍽️", shower: "🚿", clothes: "👕", health: "🩺", other: "📌" };

/** ISO weekday (1 = Monday … 7 = Sunday) of a calendar date. */
export function isoWeekday(date: string): number {
  const d = new Date(`${date}T12:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

export function openOn(p: Pick<Row, "startsOn" | "endsOn" | "weekdays" | "removedAt">, date: string): boolean {
  if (p.removedAt) return false;
  if (p.startsOn > date || (p.endsOn && p.endsOn < date)) return false;
  return p.weekdays.length === 0 || p.weekdays.includes(isoWeekday(date));
}

export class PlaceError extends DomainError {
  constructor(code: "NOT_FOUND") {
    super(code);
    this.name = "PlaceError";
  }
}

export interface PlacesService {
  today(): string;
  list(scope: "today" | "upcoming" | "all"): Promise<Place[]>;
  create(input: PlaceInput, volunteerId: string): Promise<Place>;
  update(id: string, input: PlaceInput, volunteerId: string): Promise<Place>;
  remove(id: string, volunteerId: string): Promise<void>;
  /** Places open on `date`, grouped in PLACE_KINDS order. */
  openOn(date: string): Promise<Row[]>;
  /**
   * The WhatsApp text listing today's places in `lang` (names and details translated once, then cached), with the
   * 115 line. null when nothing is posted for today.
   */
  messageFor(lang: LanguageCode, opts?: { beneficiaryId?: string | null }): Promise<string | null>;
}

const cache = new WeakMap<object, PlacesService>();
export function getPlaces(deps: PlaceDeps): PlacesService {
  let s = cache.get(deps);
  if (!s) cache.set(deps, (s = createPlacesService(deps)));
  return s;
}

const kindOrder = (k: string) => PLACE_KINDS.indexOf(k as PlaceKind);

function createPlacesService(deps: PlaceDeps): PlacesService {
  const { db, llm, config } = deps;
  const today = () => localDate(deps.now(), config.TIMEZONE);

  async function names(ids: string[]): Promise<Map<string, string>> {
    const m = new Map<string, string>();
    const unique = [...new Set(ids)];
    if (unique.length) for (const v of await db.select({ id: volunteers.id, name: volunteers.name }).from(volunteers).where(inArray(volunteers.id, unique))) m.set(v.id, v.name);
    return m;
  }

  async function toPlaces(rows: Row[]): Promise<Place[]> {
    const n = await names(rows.flatMap((r) => (r.updatedBy ? [r.updatedBy] : [])));
    const d = today();
    return rows.map((r) => ({
      id: r.id, kind: r.kind as PlaceKind, name: r.name, address: r.address, phone: r.phone, details: r.details,
      startsOn: r.startsOn, endsOn: r.endsOn, weekdays: r.weekdays, opensAt: r.opensAt, closesAt: r.closesAt,
      openToday: openOn(r, d), updatedAt: r.updatedAt.toISOString(), updatedByName: r.updatedBy ? (n.get(r.updatedBy) ?? null) : null,
    }));
  }

  const sorted = (rows: Row[]) => rows.sort((a, z) => kindOrder(a.kind) - kindOrder(z.kind) || (a.opensAt ?? "").localeCompare(z.opensAt ?? "") || a.name.localeCompare(z.name, "fr"));

  async function activeFrom(date: string): Promise<Row[]> {
    return db.select().from(places)
      .where(and(isNull(places.removedAt), or(isNull(places.endsOn), gte(places.endsOn, date))))
      .orderBy(asc(places.startsOn));
  }

  async function forDay(date: string): Promise<Row[]> {
    const rows = await db.select().from(places)
      .where(and(isNull(places.removedAt), lte(places.startsOn, date), or(isNull(places.endsOn), gte(places.endsOn, date))));
    return sorted(rows.filter((r) => openOn(r, date)));
  }

  async function mustRow(id: string): Promise<Row> {
    const [r] = await db.select().from(places).where(eq(places.id, id)).limit(1);
    if (!r || r.removedAt) throw new PlaceError("NOT_FOUND");
    return r;
  }

  const values = (i: PlaceInput) => ({
    kind: i.kind, name: i.name, address: i.address, phone: i.phone, details: i.details, startsOn: i.startsOn, endsOn: i.endsOn,
    weekdays: [...new Set(i.weekdays)].sort(), opensAt: i.opensAt, closesAt: i.closesAt,
  });

  /** Name and details in `lang`: cached per place; French text if the translation fails (still useful). */
  async function localized(r: Row, lang: LanguageCode, beneficiaryId: string | null): Promise<{ name: string; details: string | null }> {
    if (lang === "fr") return { name: r.name, details: r.details };
    const cached = r.translations[lang];
    if (cached) return cached;
    try {
      const tr = (text: string) => withUsageContext(beneficiaryId, () => llm.translateText({ text, from: "fr", to: lang }));
      const [name, details] = await Promise.all([tr(r.name), r.details ? tr(r.details) : Promise.resolve(null)]);
      const value = { name: name.trim(), details: details?.trim() ?? null };
      await db.update(places).set({ translations: sql`${places.translations} || ${JSON.stringify({ [lang]: value })}::jsonb` }).where(eq(places.id, r.id));
      return value;
    } catch (e) {
      console.error("[places] translation failed:", e instanceof Error ? e.message : String(e));
      return { name: r.name, details: r.details };
    }
  }

  return {
    today,

    async list(scope) {
      const d = today();
      const rows = scope === "today" ? await forDay(d)
        : scope === "upcoming" ? await activeFrom(d)
        : await db.select().from(places).where(isNull(places.removedAt)).orderBy(asc(places.startsOn));
      return toPlaces(rows);
    },

    async create(input, volunteerId) {
      const [r] = await db.insert(places).values({ ...values(input), createdBy: volunteerId, updatedBy: volunteerId }).returning();
      return (await toPlaces([r!]))[0]!;
    },

    async update(id, input, volunteerId) {
      await mustRow(id);
      // Edited text: the cached translations are stale.
      const [r] = await db.update(places).set({ ...values(input), translations: {}, updatedBy: volunteerId, updatedAt: deps.now() }).where(eq(places.id, id)).returning();
      return (await toPlaces([r!]))[0]!;
    },

    async remove(id, volunteerId) {
      await mustRow(id);
      await db.update(places).set({ removedAt: deps.now(), updatedBy: volunteerId }).where(eq(places.id, id));
    },

    openOn: forDay,

    async messageFor(lang, opts = {}) {
      const d = today();
      const rows = await forDay(d);
      if (rows.length === 0) return null;
      const iso = (s: string) => (isRtl(lang) ? isolate(s) : s);
      const blocks = await Promise.all(rows.slice(0, 12).map(async (r) => {
        const { name, details } = await localized(r, lang, opts.beneficiaryId ?? null);
        const lines = [`${PLACE_EMOJI[r.kind as PlaceKind]} *${name}*`];
        const hours = r.opensAt && r.closesAt ? `${r.opensAt}–${r.closesAt}` : (r.opensAt ?? r.closesAt);
        if (hours) lines.push(`🕘 ${iso(hours)}`);
        if (r.address) lines.push(`📍 ${iso(r.address)}`);
        if (r.phone) lines.push(`📞 ${iso(r.phone)}`);
        if (details) lines.push(details);
        return lines.join("\n");
      }));
      // The 115 line always closes the list: posted places fill up, the 115 is the one number that always answers.
      return [waText(lang, "places_title", { date: formatDate(d, lang) }), ...blocks, waText(lang, "places_115")].join("\n\n");
    },
  };
}

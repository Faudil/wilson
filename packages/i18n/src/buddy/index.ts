/**
 * French practice buddies: WhatsApp texts in their own catalogs, so the main catalogs stay readable.
 * Same rules as waText: every placeholder is bidi-isolated, RTL texts get a RLM at each line start, menus are written
 * "N - Label" one per line (shown as buttons or a list). Translations other than fr/en are machine-drafted and must be
 * reviewed by a native speaker (decision D7).
 */
import type { LanguageCode } from "@wilson/contracts";
import type { BuddyKey } from "./keys.js";
import { fr } from "./fr.js";
import { en } from "./en.js";
import { ar } from "./ar.js";
import { fa } from "./fa.js";
import { ps } from "./ps.js";
import { ur } from "./ur.js";
import { uk } from "./uk.js";
import { ti } from "./ti.js";
import { so } from "./so.js";
import { am } from "./am.js";
import { ru } from "./ru.js";
import { es } from "./es.js";
import { pt } from "./pt.js";
import { tr } from "./tr.js";
import { ku } from "./ku.js";
import { ckb } from "./ckb.js";
import { bn } from "./bn.js";
import { ta } from "./ta.js";
import { ka } from "./ka.js";
import { hy } from "./hy.js";
import { sq } from "./sq.js";
import { ro } from "./ro.js";
import { ht } from "./ht.js";
import { wo } from "./wo.js";
import { ff } from "./ff.js";
import { bm } from "./bm.js";
import { ln } from "./ln.js";
import { sw } from "./sw.js";

export type { BuddyKey } from "./keys.js";

export const BUDDY_CATALOGS: Record<LanguageCode, Record<BuddyKey, string>> = {
  fr, en, ar, fa, ps, ur, uk, ti, so, am, ru, es, pt, tr, ku, ckb, bn, ta, ka, hy, sq, ro, ht, wo, ff, bm, ln, sw,
};

/** Placeholders whose value is already a localised catalog text (not user data): not isolated. */
const RAW = new Set(["how"]);

export function buddyTemplate(lang: LanguageCode, key: BuddyKey): string {
  return BUDDY_CATALOGS[lang][key];
}
export const isRawBuddyParam = (name: string): boolean => RAW.has(name);

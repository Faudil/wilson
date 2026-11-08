/**
 * Texts of the beneficiaries' web space ("Mon espace"). Same rules as the WhatsApp catalogs: placeholders are
 * bidi-isolated by webText(). Translations other than fr/en are machine-drafted and must be reviewed by a native
 * speaker (decision D7).
 */
import type { LanguageCode } from "@wilson/contracts";
import type { WebKey } from "./keys.js";
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

export { WEB_KEYS, type WebKey } from "./keys.js";

export const WEB_CATALOGS: Record<LanguageCode, Record<WebKey, string>> = {
  fr, en, ar, fa, ps, ur, uk, ti, so, am, ru, es, pt, tr, ku, ckb, bn, ta, ka, hy, sq, ro, ht, wo, ff, bm, ln, sw,
};

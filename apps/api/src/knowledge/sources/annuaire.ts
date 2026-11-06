import type { KnowledgeChunkInput, SourceAdapter } from "../types.js";

export const ANNUAIRE_URL = "https://api-lannuaire.service-public.fr/api/explore/v2.1/catalog/datasets/api-lannuaire-administration/records";

/** Human label for each pivot type (`type_service_local`). Unknown types fall back to the raw value. */
export const TYPE_LABELS: Record<string, string> = {
  prefecture: "Préfecture",
  sous_pref: "Sous-préfecture",
  caf: "Caisse d'allocations familiales (CAF)",
  cpam: "Caisse primaire d'assurance maladie (CPAM)",
  point_justice: "Point-justice (accès au droit, aide juridique gratuite)",
  maison_justice: "Maison de justice et du droit (accès au droit)",
  cdad: "Conseil départemental de l'accès au droit (CDAD)",
  france_services: "France services (aide aux démarches administratives)",
  msap: "Maison de services au public (France services)",
  ofii: "Office français de l'immigration et de l'intégration (OFII)",
  pole_emploi: "Pôle emploi / France Travail",
  france_travail: "France Travail (ex Pôle emploi)",
  sip: "Service des impôts des particuliers (SIP)",
  sie: "Service des impôts des entreprises (SIE)",
  mairie: "Mairie",
  tribunal_administratif: "Tribunal administratif",
};


type Rec = Record<string, unknown>;

/** Opendatasoft returns some columns as JSON strings and some as real JSON — accept both. */
function json(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const t = v.trim();
  if (!t || !/^[[{]/.test(t)) return t || null;
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}
const list = (v: unknown): Rec[] => {
  const j = json(v);
  if (Array.isArray(j)) return j.filter((x): x is Rec => typeof x === "object" && x !== null);
  if (j && typeof j === "object") return [j as Rec];
  return [];
};
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");

export function pivotTypes(rec: Rec): string[] {
  const p = json(rec.pivot);
  if (typeof p === "string") return [p];
  return list(p).map((x) => str(x.type_service_local)).filter(Boolean);
}

function formatAddress(rec: Rec): { text: string; postalCode: string; city: string } {
  const a = list(rec.adresse).find((x) => /adresse|physique/i.test(str(x.type_adresse)) || !x.type_adresse) ?? list(rec.adresse)[0];
  if (a) {
    const line = [str(a.complement1), str(a.complement2), str(a.numero_voie)].filter(Boolean).join(", ");
    const postalCode = str(a.code_postal);
    const city = str(a.nom_commune);
    return { text: [line, [postalCode, city].filter(Boolean).join(" ")].filter(Boolean).join(", "), postalCode, city };
  }
  const raw = json(rec.adresse_postale ?? rec.adresse);
  const text = typeof raw === "string" ? raw : "";
  const m = text.match(/\b(\d{5})\s+([^,]+)$/);
  return { text, postalCode: m?.[1] ?? "", city: m?.[2]?.trim() ?? "" };
}

const hhmm = (t: string): string => {
  const m = t.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return t;
  return `${Number(m[1])}h${m[2] === "00" ? "" : m[2]}`;
};

/** "du lundi au vendredi de 9h à 12h30 et de 14h à 17h" */
export function formatOpeningHours(v: unknown): string {
  const parts: string[] = [];
  for (const p of list(v)) {
    const d1 = str(p.nom_jour_debut).toLowerCase();
    const d2 = str(p.nom_jour_fin).toLowerCase();
    const days = !d1 ? "" : d1 === d2 || !d2 ? `le ${d1}` : `du ${d1} au ${d2}`;
    const slots: string[] = [];
    for (const i of ["1", "2"]) {
      const a = str(p[`valeur_heure_debut_${i}`]);
      const b = str(p[`valeur_heure_fin_${i}`]);
      if (a && b) slots.push(`de ${hhmm(a)} à ${hhmm(b)}`);
    }
    const comment = str(p.commentaire);
    const s = [days, slots.join(" et ")].filter(Boolean).join(" ");
    if (s || comment) parts.push(s && comment ? `${s} (${comment})` : s || comment);
  }
  return parts.join(" ; ");
}

function websites(v: unknown): string[] {
  const j = json(v);
  if (typeof j === "string") return /^https?:/.test(j) ? [j] : [];
  return list(j).map((x) => str(x.valeur ?? x.url)).filter(Boolean);
}
function phones(v: unknown): string[] {
  const j = json(v);
  if (typeof j === "string") return [j];
  return list(j).map((x) => [str(x.valeur), str(x.description)].filter(Boolean).join(" ")).filter(Boolean);
}

/** Département from a postal code ("75001" → "75", "20090" → "2A", "97400" → "974"). */
export function departmentOf(postalCode: string, insee = ""): string | null {
  const code = insee || postalCode;
  if (!/^\d/.test(code) && !/^[0-9][AB]/i.test(code)) return null;
  if (/^2[AB]/i.test(code)) return code.slice(0, 2).toUpperCase();
  if (/^97|^98/.test(code)) return code.slice(0, 3);
  if (/^20/.test(code)) return Number(postalCode.slice(0, 3)) < 202 ? "2A" : "2B";
  return code.slice(0, 2);
}

export function recordToChunk(rec: Rec, matchedType: string): KnowledgeChunkInput | null {
  const name = str(rec.nom);
  const id = str(rec.id);
  if (!name || !id) return null;
  const addr = formatAddress(rec);
  const dept = departmentOf(addr.postalCode, str(rec.code_insee_commune));
  const tel = phones(rec.telephone);
  const hours = formatOpeningHours(rec.plage_ouverture);
  const sites = websites(rec.site_internet);
  const mail = str(rec.adresse_courriel);
  const lines = [
    `Type : ${TYPE_LABELS[matchedType] ?? matchedType}`,
    addr.text && `Adresse : ${addr.text}`,
    tel.length > 0 && `Téléphone : ${tel.join(" ; ")}`,
    hours && `Horaires : ${hours}`,
    sites[0] && `Site internet : ${sites[0]}`,
    mail && `Courriel : ${mail}`,
  ].filter(Boolean);
  const modified = str(rec.date_modification);
  return {
    externalId: id,
    kind: "contact",
    title: name,
    url: str(rec.url_service_public) || sites[0] || null,
    department: dept,
    text: lines.join("\n"),
    sourceUpdatedAt: modified && !Number.isNaN(Date.parse(modified)) ? new Date(modified) : null,
  };
}

interface Page {
  total_count?: number;
  results?: Rec[];
}

const PAGE = 100;
const MAX_PER_TYPE = 40;
const MAX_MAIRIES = 5;

export const annuaireAdapter: SourceAdapter = {
  id: "annuaire",
  name: "Annuaire de l'administration (service-public.fr)",
  license: "Licence Ouverte 2.0 (DILA)",
  homepage: "https://www.data.gouv.fr/datasets/annuaire-de-l-administration-base-de-donnees-locales",
  enabledByDefault: true,
  disabledReason: null,
  async *fetch({ config, fetch: doFetch, log }) {
    const departments = config.KNOWLEDGE_DEPARTMENTS.split(",").map((d) => d.trim()).filter(Boolean);
    const types = config.ANNUAIRE_TYPES.split(",").map((t) => t.trim()).filter(Boolean);
    const seen = new Set<string>();
    let total = 0;
    for (const dept of departments) {
      let prefectureCity = "";
      // préfecture first, so we know the main city for the mairie
      const ordered = [...types].sort((a, b) => Number(b === "prefecture") - Number(a === "prefecture"));
      for (const type of ordered) {
        const cap = type === "mairie" ? MAX_MAIRIES : MAX_PER_TYPE;
        let got = 0;
        for (let offset = 0; offset < 2000 && got < cap; offset += PAGE) {
          const u = new URL(ANNUAIRE_URL);
          u.searchParams.set("where", `search(pivot, "${type}") and code_insee_commune like "${dept}%"`);
          u.searchParams.set("limit", String(PAGE));
          u.searchParams.set("offset", String(offset));
          const res = await doFetch(u, { signal: AbortSignal.timeout(60_000), headers: { accept: "application/json" } });
          if (!res.ok) throw new Error(`Annuaire: HTTP ${res.status} (département ${dept}, type ${type})`);
          const page = (await res.json()) as Page;
          const results = page.results ?? [];
          for (const rec of results) {
            // The query is approximate (full-text on the pivot column): re-check type and département here.
            if (!pivotTypes(rec).includes(type)) continue;
            const chunk = recordToChunk(rec, type);
            if (!chunk || chunk.department !== dept || seen.has(chunk.externalId)) continue;
            if (type === "prefecture" && !prefectureCity) prefectureCity = /\b\d{5}\s+(.+)$/.exec(chunk.text.split("\n").find((l) => l.startsWith("Adresse")) ?? "")?.[1]?.trim() ?? "";
            if (type === "mairie" && prefectureCity && !chunk.text.includes(prefectureCity)) continue;
            seen.add(chunk.externalId);
            got++;
            total++;
            yield chunk;
            if (got >= cap) break;
          }
          if (results.length < PAGE || (page.total_count !== undefined && offset + PAGE >= page.total_count)) break;
        }
        log(`annuaire ${dept} ${type}: ${got}`);
      }
    }
    if (total === 0) throw new Error(`Annuaire: aucun service trouvé pour les départements ${departments.join(", ")}`);
  },
};


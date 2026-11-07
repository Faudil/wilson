import type { AssociationRef } from "@wilson/contracts";
import type { Deps } from "../deps.js";

/**
 * Association lookup for the volunteer sign-up form, from the official register: API Recherche d'entreprises
 * (DINUM, open data, no key; associations come from the RNA). Called by the server only, so the volunteer's
 * browser never talks to a third party, and only with what the volunteer typed (never beneficiary data).
 * Failures (network, rate limit, bad payload) return [] so the form falls back to free text.
 */
export interface AssociationSearch {
  search(query: string): Promise<AssociationRef[]>;
}

type ApiResult = {
  siren?: unknown;
  nom_complet?: unknown;
  nom_raison_sociale?: unknown;
  siege?: { libelle_commune?: unknown; code_postal?: unknown } | null;
  complements?: { identifiant_association?: unknown; est_association?: unknown } | null;
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** "PARIS" → "Paris", "SAINT-DENIS" → "Saint-Denis". */
function titleCase(s: string): string {
  return s.toLocaleLowerCase("fr").replace(/(^|[\s'’-])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toLocaleUpperCase("fr"));
}

export function mapResults(payload: unknown): AssociationRef[] {
  const results = (payload as { results?: unknown })?.results;
  if (!Array.isArray(results)) return [];
  const out: AssociationRef[] = [];
  for (const r of results as ApiResult[]) {
    const name = str(r.nom_complet) ?? str(r.nom_raison_sociale);
    if (!name) continue;
    const siren = str(r.siren);
    const rna = str(r.complements?.identifiant_association);
    const city = str(r.siege?.libelle_commune);
    const cp = str(r.siege?.code_postal);
    out.push({
      name: name.slice(0, 200),
      siren: siren && /^\d{9}$/.test(siren) ? siren : null,
      rna: rna && /^W[0-9A-Z]{9}$/.test(rna) ? rna : null,
      city: city ? `${titleCase(city)}${cp ? ` (${cp.slice(0, 2)})` : ""}`.slice(0, 100) : null,
    });
  }
  return out;
}

const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX = 500;
/** The upstream allows ~7 requests/s per IP; stay well below and never let the public form be used as a proxy. */
const MAX_PER_MINUTE = 120;

export function createAssociationSearch(deps: Pick<Deps, "config" | "now"> & { fetch?: typeof fetch }): AssociationSearch {
  const doFetch = deps.fetch ?? fetch;
  const cache = new Map<string, { at: number; value: AssociationRef[] }>();
  let windowStart = 0;
  let windowCount = 0;

  return {
    async search(query) {
      if (deps.config.ASSOCIATION_SEARCH !== "on") return [];
      const q = query.trim().replace(/\s+/g, " ").slice(0, 100);
      if (q.length < 3) return [];
      const key = q.toLocaleLowerCase("fr");
      const now = deps.now().getTime();
      const hit = cache.get(key);
      if (hit && now - hit.at < CACHE_TTL_MS) return hit.value;

      if (now - windowStart > 60_000) {
        windowStart = now;
        windowCount = 0;
      }
      if (++windowCount > MAX_PER_MINUTE) return [];

      const url = new URL(deps.config.ASSOCIATION_SEARCH_URL);
      url.searchParams.set("q", q);
      url.searchParams.set("est_association", "true");
      url.searchParams.set("etat_administratif", "A");
      url.searchParams.set("per_page", "8");
      url.searchParams.set("minimal", "true");
      url.searchParams.set("include", "siege,complements");
      try {
        const res = await doFetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(4000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const value = mapResults(await res.json());
        if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
        cache.set(key, { at: now, value });
        return value;
      } catch (e) {
        console.error("[associations] search failed:", e instanceof Error ? e.message : String(e));
        return [];
      }
    },
  };
}

const instances = new WeakMap<object, AssociationSearch>();
export function getAssociationSearch(deps: Deps): AssociationSearch {
  let s = instances.get(deps);
  if (!s) instances.set(deps, (s = createAssociationSearch(deps)));
  return s;
}

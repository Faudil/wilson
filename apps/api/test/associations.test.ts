import { afterEach, describe, expect, it } from "bun:test";
import { createAssociationSearch, getAssociationSearch, mapResults } from "../src/associations/search.js";
import { createVolunteer, makeClient, testConfig } from "./helpers.js";
import { makeE2E, type E2E } from "./e2e.helpers.js";

let t: E2E | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

/** Shape of a real API Recherche d'entreprises answer (minimal=true&include=siege,complements), trimmed. */
const PAYLOAD = {
  results: [
    {
      siren: "775666696",
      nom_complet: "SECOURS CATHOLIQUE CARITAS FRANCE",
      nom_raison_sociale: "SECOURS CATHOLIQUE",
      siege: { code_postal: "75007", libelle_commune: "PARIS" },
      complements: { est_association: true, identifiant_association: "W751004076" },
    },
    { siren: "123", nom_complet: "SANS RNA", siege: { libelle_commune: "SAINT-DENIS", code_postal: "93200" }, complements: {} },
    { siren: "999999999" }, // no name: skipped
  ],
  total_results: 3,
};

const fakeFetch = (calls: URL[], respond: () => Response) =>
  (async (url: URL | string) => {
    calls.push(new URL(String(url)));
    return respond();
  }) as unknown as typeof fetch;

describe("association register search", () => {
  it("maps results: name, SIREN, RNA, city with département; drops invalid ids", () => {
    expect(mapResults(PAYLOAD)).toEqual([
      { name: "SECOURS CATHOLIQUE CARITAS FRANCE", siren: "775666696", rna: "W751004076", city: "Paris (75)" },
      { name: "SANS RNA", siren: null, rna: null, city: "Saint-Denis (93)" },
    ]);
    expect(mapResults({ nope: 1 })).toEqual([]);
  });

  it("queries associations only, caches, and returns [] on failure or when off", async () => {
    const calls: URL[] = [];
    const config = testConfig({ ASSOCIATION_SEARCH: "on" });
    const s = createAssociationSearch({ config, now: () => new Date(), fetch: fakeFetch(calls, () => Response.json(PAYLOAD)) });
    expect((await s.search("  secours   catholique ")).length).toBe(2);
    expect(await s.search("Secours Catholique")).toHaveLength(2); // cached (case-insensitive)
    expect(calls).toHaveLength(1);
    expect(calls[0]!.origin + calls[0]!.pathname).toBe("https://recherche-entreprises.api.gouv.fr/search");
    expect(Object.fromEntries(calls[0]!.searchParams)).toMatchObject({ q: "secours catholique", est_association: "true", etat_administratif: "A" });
    expect(await s.search("ab")).toEqual([]);

    const down = createAssociationSearch({ config, now: () => new Date(), fetch: fakeFetch([], () => new Response("busy", { status: 429 })) });
    expect(await down.search("secours")).toEqual([]);

    const offCalls: URL[] = [];
    const off = createAssociationSearch({ config: testConfig({ ASSOCIATION_SEARCH: "off" }), now: () => new Date(), fetch: fakeFetch(offCalls, () => Response.json(PAYLOAD)) });
    expect(await off.search("secours")).toEqual([]);
    expect(offCalls).toHaveLength(0);
  });

  it("public RPC → sign-up stores the picked association → admins see it; free text is kept unverified", async () => {
    t = await makeE2E({ config: { ASSOCIATION_SEARCH: "on" } });
    (t.deps as { fetch?: typeof fetch }).fetch = fakeFetch([], () => Response.json(PAYLOAD));
    getAssociationSearch(t.deps); // built with the fake fetch
    const anon = makeClient(t.deps).client;
    const found = await anon.auth.searchAssociations({ query: "secours" });
    expect(found[0]).toMatchObject({ rna: "W751004076", city: "Paris (75)" });

    const base = { password: "bien-long-mot-de-passe", uiLanguage: "fr" as const, acceptsConfidentiality: true as const };
    await anon.auth.signup({ ...base, name: "Avec Asso", email: "asso@example.org", association: found[0]! });
    await anon.auth.signup({ ...base, name: "Texte Libre", email: "libre@example.org", association: { name: "Collectif du quartier", siren: null, rna: null, city: null } });
    await anon.auth.signup({ ...base, name: "Sans Asso", email: "sans@example.org" });

    const a = await createVolunteer(t.deps, { role: "admin" });
    const admin = makeClient(t.deps).client;
    await admin.auth.login({ email: a.email, password: a.password });
    const byEmail = Object.fromEntries((await admin.volunteers.list({ status: "pending" })).map((v) => [v.email, v.association]));
    expect(byEmail["asso@example.org"]).toEqual({ name: "SECOURS CATHOLIQUE CARITAS FRANCE", siren: "775666696", rna: "W751004076", city: "Paris (75)" });
    expect(byEmail["libre@example.org"]).toEqual({ name: "Collectif du quartier", siren: null, rna: null, city: null });
    expect(byEmail["sans@example.org"]).toBeNull();
  });
});

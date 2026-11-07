import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { JOBS } from "../src/jobs/names.js";
import { createLocalDb } from "../src/local/pglite.js";
import { createKnowledgeService, enqueueInitialSync } from "../src/knowledge/service.js";
import { annuaireAdapter } from "../src/knowledge/sources/annuaire.js";
import { servicePublicAdapter } from "../src/knowledge/sources/servicePublic.js";
import { watizatAdapter } from "../src/knowledge/sources/watizat.js";
import type { KnowledgeChunkInput, SourceAdapter } from "../src/knowledge/types.js";
import { knowledgeChunks } from "../src/db/schema.js";
import { createVolunteer, makeClient, makeTestDeps, testConfig, type TestCtx } from "./helpers.js";
import { fakeFetch, fichesZip, makeZip } from "./knowledge.helpers.js";
import { eq } from "drizzle-orm";

let t: TestCtx;
beforeAll(async () => {
  t = await makeTestDeps({ config: { KNOWLEDGE_DEPARTMENTS: "75", ANNUAIRE_TYPES: "prefecture,point_justice,caf" } });
});
afterAll(() => t.close());

const svc = (fetchFn = fakeFetch(), adapters?: SourceAdapter[]) => createKnowledgeService({ db: t.deps.db, config: t.config, fetch: fetchFn, adapters, log: () => undefined });

describe("sync + search (Postgres)", () => {
  it("indexes sources, lists them with counts, ranks and filters by department", async () => {
    const k = svc();
    expect(await k.sync("service_public")).toBe(9);
    expect(await k.sync("annuaire")).toBe(3);

    const sources = await k.listSources();
    expect(sources.map((s) => [s.id, s.enabled, s.chunkCount])).toEqual([
      ["service_public", true, 9],
      ["annuaire", true, 3],
      ["association", true, 0],
      ["watizat", false, 0],
    ]);
    expect(sources[3]!.disabledReason).toBe("En attente de l'autorisation de Watizat");
    expect(sources[0]!.lastSyncAt).not.toBeNull();

    const hits = await k.search({ query: "renouveler titre de séjour préfecture", department: "75" });
    expect(hits[0]).toMatchObject({ sourceId: "service_public", kind: "procedure" });
    expect(hits[0]!.title).toContain("Renouvellement d'un titre de séjour");
    expect(hits.some((h) => h.title === "Préfecture de police de Paris")).toBe(true);
    expect(hits[0]!.excerpt.length).toBeGreaterThan(10);
    expect(hits[0]!.excerpt).not.toContain("<b>");

    // Other département: Paris contacts are hidden, national procedures stay.
    const lyon = await k.search({ query: "renouveler titre de séjour préfecture", department: "69" });
    expect(lyon.length).toBeGreaterThan(0);
    expect(lyon.some((h) => h.kind === "contact")).toBe(false);

    // A long French summary still matches (OR semantics) and kinds filter works.
    const long = await k.search({ query: "Cette lettre de la préfecture vous convoque pour le renouvellement de votre titre de séjour. Vous devez apporter un justificatif de domicile.", kinds: ["procedure"], limit: 3 });
    expect(long.length).toBeLessThanOrEqual(3);
    expect(long[0]!.title).toContain("titre de séjour");

    const ame = await k.search({ query: "aide médicale AME CPAM" });
    expect(ame[0]!.title).toContain("AME");
    expect(await k.search({ query: "le la de" })).toEqual([]);
    expect(await k.search({ query: "xyzzyplugh" })).toEqual([]);

    const chunks = await k.getChunks([hits[0]!.id, "00000000-0000-4000-8000-000000000000"]);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.text.length).toBeGreaterThan(0);
  });

  it("re-sync upserts in place and removes chunks that disappeared", async () => {
    const before = await t.deps.db.select().from(knowledgeChunks).where(eq(knowledgeChunks.sourceId, "service_public"));
    // Archive without the AME fiche.
    const zip = makeZip({
      "x/F2741.xml": (await import("node:fs")).readFileSync(new URL("./fixtures/knowledge/fiches/F2741.xml", import.meta.url)),
      "x/F18074.xml": (await import("node:fs")).readFileSync(new URL("./fixtures/knowledge/fiches/F18074.xml", import.meta.url)),
    });
    const k = svc(fakeFetch({ zip }));
    const n = await k.sync("service_public");
    expect(n).toBeLessThan(before.length);
    const after = await t.deps.db.select().from(knowledgeChunks).where(eq(knowledgeChunks.sourceId, "service_public"));
    expect(after).toHaveLength(n);
    expect(after.some((c) => c.title.includes("AME"))).toBe(false);
    // unchanged chunks keep their id (upsert, not delete+insert)
    const stableBefore = before.find((c) => c.externalId === "F2741#0.0")!;
    expect(after.find((c) => c.externalId === "F2741#0.0")!.id).toBe(stableBefore.id);
    expect((await k.search({ query: "aide médicale AME" })).some((h) => h.title.includes("AME"))).toBe(false);
  });

  it("failed sync keeps old data and records lastError; success clears it", async () => {
    const k = svc(fakeFetch({ status: 502 }));
    const count = (await k.listSources())[0]!.chunkCount;
    await expect(k.sync("service_public")).rejects.toThrow(/502/);
    const s = (await k.listSources())[0]!;
    expect(s.lastError).toMatch(/502/);
    expect(s.chunkCount).toBe(count);
    await svc().sync("service_public");
    expect((await k.listSources())[0]!.lastError).toBeNull();
  });

  it("refuses to sync a disabled source, and enables it through KNOWLEDGE_ENABLE", async () => {
    await expect(svc().sync("watizat")).rejects.toThrow(/désactivée.*Watizat/);
    const enabled = createKnowledgeService({ db: t.deps.db, config: testConfig({ KNOWLEDGE_ENABLE: "watizat", KNOWLEDGE_DIR: join(tmpdir(), "nope-kb") }), adapters: [watizatAdapter], log: () => undefined });
    expect((await enabled.listSources())[0]).toMatchObject({ id: "watizat", enabled: true, disabledReason: null });
    expect(await enabled.sync("watizat")).toBe(0);
  });

  it("disabled sources are not searched", async () => {
    const stub: SourceAdapter = {
      ...watizatAdapter,
      async *fetch() {
        yield { externalId: "g1", kind: "guide", title: "Guide secret hébergement", url: null, department: "75", text: "hébergement urgence 115 guide", sourceUpdatedAt: null } satisfies KnowledgeChunkInput;
      },
    };
    const on = createKnowledgeService({ db: t.deps.db, config: testConfig({ KNOWLEDGE_ENABLE: "watizat" }), adapters: [stub], log: () => undefined });
    await on.sync("watizat");
    expect((await on.search({ query: "hébergement urgence" })).map((h) => h.sourceId)).toContain("watizat");
    const off = createKnowledgeService({ db: t.deps.db, config: testConfig({ KNOWLEDGE_ENABLE: "" }), adapters: [stub], log: () => undefined });
    expect(await off.search({ query: "hébergement urgence" })).toEqual([]);
  });

  it("services.knowledge exists and initial sync is queued once when empty", async () => {
    expect(t.services.knowledge).toBeDefined();
    const empty = createKnowledgeService({ db: t.deps.db, config: t.config, adapters: [], log: () => undefined });
    t.queue.clear();
    expect(await enqueueInitialSync(empty, t.queue, t.config)).toBe(true);
    expect(t.queue.jobs(JOBS.knowledgeSync)).toEqual([{}]);
    expect(await enqueueInitialSync(svc(), t.queue, t.config)).toBe(false); // already has chunks
    expect(await enqueueInitialSync(empty, t.queue, testConfig({ RAG_ENABLED: "" }))).toBe(false);
  });
});

describe("RPC", () => {
  it("requires permissions; sync only enqueues", async () => {
    const anon = makeClient(t.deps).client;
    await expect(anon.knowledge.sources()).rejects.toMatchObject({ code: "UNAUTHORIZED" });

    const vol = await createVolunteer(t.deps, { role: "volunteer" });
    const v = makeClient(t.deps);
    await v.client.auth.login({ email: vol.email, password: vol.password });
    expect((await v.client.knowledge.sources()).length).toBe(4);
    expect((await v.client.knowledge.search({ query: "titre de séjour", limit: 5 })).length).toBeGreaterThan(0);
    await expect(v.client.knowledge.sync({ sourceId: "annuaire" })).rejects.toMatchObject({ code: "FORBIDDEN" });

    const adm = await createVolunteer(t.deps, { role: "admin" });
    const a = makeClient(t.deps);
    await a.client.auth.login({ email: adm.email, password: adm.password });
    t.queue.clear();
    expect(await a.client.knowledge.sync({ sourceId: "annuaire" })).toEqual({ queued: true });
    expect(t.queue.jobs(JOBS.knowledgeSync)).toEqual([{ sourceId: "annuaire" }]);
  });
});

describe("PGlite (RUNTIME=local)", () => {
  it("migrations apply and sync + French search work", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kb-pglite-"));
    const local = await createLocalDb(dir);
    try {
      const k = createKnowledgeService({ db: local.db, config: testConfig({ KNOWLEDGE_DEPARTMENTS: "75", ANNUAIRE_TYPES: "prefecture,point_justice,caf" }), fetch: fakeFetch({ zip: fichesZip() }), adapters: [servicePublicAdapter, annuaireAdapter], log: () => undefined });
      await k.sync("service_public");
      await k.sync("annuaire");
      const hits = await k.search({ query: "renouveler titre de séjour préfecture", department: "75" });
      expect(hits[0]!.title).toContain("Renouvellement d'un titre de séjour");
      expect(hits.some((h) => h.kind === "contact")).toBe(true);
      expect((await k.search({ query: "renouveler titre de séjour préfecture", department: "69" })).some((h) => h.kind === "contact")).toBe(false);
      await k.sync("service_public"); // second run: upsert path
    } finally {
      await local.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

import { and, asc, count, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { KnowledgeHit, KnowledgeSource, KnowledgeSourceId } from "@wilson/contracts";
import type { Config } from "../config.js";
import type { Db } from "../db/client.js";
import { knowledgeChunks, knowledgeSources } from "../db/schema.js";
import { JOBS, type JobQueue } from "../jobs/names.js";
import { ADAPTERS } from "./sources/index.js";
import type { KnowledgeChunkInput, KnowledgeSearchQuery, KnowledgeService, SourceAdapter } from "./types.js";

export interface KnowledgeDeps {
  db: Db;
  config: Config;
  /** Injected in tests. */
  fetch?: typeof fetch;
  adapters?: SourceAdapter[];
  log?: (msg: string) => void;
}

const STOPWORDS = new Set(
  ("le la les un une des du de d l au aux et ou mais donc or ni car que qui quoi dont où ne pas plus ce cet cette ces se sa son ses ma mon mes ta ton tes notre votre nos vos leur leurs il elle ils elles on nous vous je tu me te lui y en a as ai avez avons ont est es sont suis etes êtes sommes être avoir fait faire pour par sur sous dans avec sans vers chez entre depuis pendant avant après comme si très tout tous toute toutes aussi alors cela ceci celui celle être été soit puis votre vos doit doivent peut peuvent il y").split(/\s+/),
);

/** OR-joined tsquery source ("renouvel | titr | séjour"); null when nothing searchable is left. */
export function buildTsQuery(q: string): string | null {
  const words = q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  const uniq = [...new Set(words)].slice(0, 40);
  return uniq.length ? uniq.join(" | ") : null;
}

let lastStamp = 0;
const nextStamp = (): Date => {
  lastStamp = Math.max(Date.now(), lastStamp + 1);
  return new Date(lastStamp);
};

export function isSourceEnabled(a: SourceAdapter, override: boolean | null | undefined, config: Config): boolean {
  if (override !== null && override !== undefined) return override;
  if (a.enabledByDefault) return true;
  return config.KNOWLEDGE_ENABLE.split(",").map((s) => s.trim()).includes(a.id);
}

export function createKnowledgeService(deps: KnowledgeDeps): KnowledgeService {
  const { db, config } = deps;
  const adapters = deps.adapters ?? ADAPTERS;
  const log = deps.log ?? ((m: string) => console.log(`[knowledge] ${m}`));
  const find = (id: KnowledgeSourceId): SourceAdapter => {
    const a = adapters.find((x) => x.id === id);
    if (!a) throw new Error(`unknown knowledge source: ${id}`);
    return a;
  };

  async function enabledIds(): Promise<KnowledgeSourceId[]> {
    const rows = await db.select().from(knowledgeSources);
    return adapters.filter((a) => isSourceEnabled(a, rows.find((r) => r.id === a.id)?.enabled, config)).map((a) => a.id);
  }

  async function recordSync(id: KnowledgeSourceId, patch: { lastSyncAt?: Date; lastError: string | null }): Promise<void> {
    await db.insert(knowledgeSources).values({ id, ...patch }).onConflictDoUpdate({ target: knowledgeSources.id, set: patch });
  }

  return {
    async listSources() {
      const rows = await db.select().from(knowledgeSources);
      const counts = await db.select({ id: knowledgeChunks.sourceId, n: count() }).from(knowledgeChunks).groupBy(knowledgeChunks.sourceId);
      return adapters.map((a): KnowledgeSource => {
        const row = rows.find((r) => r.id === a.id);
        const enabled = isSourceEnabled(a, row?.enabled, config);
        return {
          id: a.id,
          name: a.name,
          license: a.license,
          homepage: a.homepage,
          enabled,
          disabledReason: enabled ? null : a.disabledReason,
          chunkCount: Number(counts.find((c) => c.id === a.id)?.n ?? 0),
          lastSyncAt: row?.lastSyncAt ? row.lastSyncAt.toISOString() : null,
          lastError: row?.lastError ?? null,
        };
      });
    },

    async sync(sourceId) {
      const adapter = find(sourceId);
      const row = (await db.select().from(knowledgeSources).where(eq(knowledgeSources.id, sourceId)))[0];
      if (!isSourceEnabled(adapter, row?.enabled, config)) {
        throw new Error(`Source "${sourceId}" désactivée${adapter.disabledReason ? ` : ${adapter.disabledReason}` : ""}`);
      }
      try {
        const chunks = new Map<string, KnowledgeChunkInput>();
        for await (const c of adapter.fetch({ config, fetch: deps.fetch ?? fetch, log: (m) => log(`${sourceId}: ${m}`) })) chunks.set(c.externalId, c);
        const stamp = nextStamp();
        const all = [...chunks.values()];
        await db.transaction(async (tx) => {
          for (let i = 0; i < all.length; i += 200) {
            const batch = all.slice(i, i + 200).map((c) => ({ sourceId, ...c, syncedAt: stamp }));
            await tx
              .insert(knowledgeChunks)
              .values(batch)
              .onConflictDoUpdate({
                target: [knowledgeChunks.sourceId, knowledgeChunks.externalId],
                set: {
                  kind: sql`excluded.kind`,
                  title: sql`excluded.title`,
                  url: sql`excluded.url`,
                  department: sql`excluded.department`,
                  text: sql`excluded.text`,
                  sourceUpdatedAt: sql`excluded.source_updated_at`,
                  syncedAt: sql`excluded.synced_at`,
                },
              });
          }
          await tx.delete(knowledgeChunks).where(and(eq(knowledgeChunks.sourceId, sourceId), ne(knowledgeChunks.syncedAt, stamp)));
        });
        await recordSync(sourceId, { lastSyncAt: new Date(), lastError: null });
        log(`${sourceId}: ${all.length} chunks`);
        return all.length;
      } catch (err) {
        await recordSync(sourceId, { lastError: (err as Error).message.slice(0, 500) }).catch(() => undefined);
        throw err;
      }
    },

    async search(q: KnowledgeSearchQuery): Promise<KnowledgeHit[]> {
      const tsq = buildTsQuery(q.query);
      if (!tsq) return [];
      const enabled = await enabledIds();
      if (enabled.length === 0) return [];
      const query = sql`to_tsquery('french', ${tsq})`;
      const rank = sql<number>`ts_rank_cd(${knowledgeChunks.tsv}, ${query}, 1)`;
      const conds = [sql`${knowledgeChunks.tsv} @@ ${query}`, inArray(knowledgeChunks.sourceId, enabled)];
      if (q.kinds?.length) conds.push(inArray(knowledgeChunks.kind, q.kinds));
      if (q.department) {
        conds.push(or(ne(knowledgeChunks.kind, "contact"), isNull(knowledgeChunks.department), eq(knowledgeChunks.department, q.department))!);
      }
      const rows = await db
        .select({ id: knowledgeChunks.id, sourceId: knowledgeChunks.sourceId, kind: knowledgeChunks.kind, title: knowledgeChunks.title, url: knowledgeChunks.url, department: knowledgeChunks.department, text: knowledgeChunks.text, score: rank })
        .from(knowledgeChunks)
        .where(and(...conds))
        .orderBy(desc(rank), asc(knowledgeChunks.title))
        .limit(q.limit ?? 8);
      if (rows.length === 0) return [];
      const heads = await db
        .select({ id: knowledgeChunks.id, h: sql<string>`ts_headline('french', ${knowledgeChunks.text}, ${query}, 'MaxFragments=0, MaxWords=40, MinWords=15, StartSel=<b>, StopSel=</b>')` })
        .from(knowledgeChunks)
        .where(inArray(knowledgeChunks.id, rows.map((r) => r.id)));
      const headline = new Map(heads.map((h) => [h.id, h.h]));
      return rows.map((r) => {
        const h = (headline.get(r.id) ?? "").replace(/<\/?b>/g, "").replace(/\s+/g, " ").trim();
        return {
          id: r.id,
          sourceId: r.sourceId,
          kind: r.kind,
          title: r.title,
          url: r.url,
          department: r.department,
          excerpt: h.length >= 20 ? h : r.text.slice(0, 300),
          score: Number(r.score),
        };
      });
    },

    async getChunks(ids) {
      if (ids.length === 0) return [];
      const rows = await db
        .select({ id: knowledgeChunks.id, sourceId: knowledgeChunks.sourceId, title: knowledgeChunks.title, url: knowledgeChunks.url, text: knowledgeChunks.text })
        .from(knowledgeChunks)
        .where(inArray(knowledgeChunks.id, ids));
      const byId = new Map(rows.map((r) => [r.id, r]));
      return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
    },
  };
}

/** First start: if nothing has been indexed yet, queue a sync of every enabled source (no-op when RAG is off). */
export async function enqueueInitialSync(service: KnowledgeService, jobs: JobQueue, config: Config): Promise<boolean> {
  if (!config.RAG_ENABLED) return false;
  const sources = await service.listSources();
  if (sources.some((s) => s.chunkCount > 0)) return false;
  await jobs.send(JOBS.knowledgeSync, {}, { singletonKey: "initial" });
  return true;
}

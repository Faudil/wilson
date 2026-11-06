/**
 * Knowledge base (RAG) — integration points. Implemented by batch "knowledge"; consumed by the
 * orientation step (letters) and the RPC router.
 */
import type { KnowledgeHit, KnowledgeSource, KnowledgeSourceId } from "@wilson/contracts";
import type { Config } from "../config.js";

export interface KnowledgeChunkInput {
  externalId: string;
  kind: "procedure" | "contact" | "guide";
  title: string;
  url: string | null;
  department: string | null;
  text: string;
  sourceUpdatedAt: Date | null;
}

/** One adapter per source. `fetch` yields every chunk of the source; sync replaces the source's chunks atomically. */
export interface SourceAdapter {
  id: KnowledgeSourceId;
  name: string;
  license: string;
  homepage: string;
  enabledByDefault: boolean;
  /** Shown in the back-office when disabled by default. */
  disabledReason: string | null;
  fetch(ctx: { config: Config; fetch: typeof fetch; log: (msg: string) => void }): AsyncIterable<KnowledgeChunkInput>;
}

export interface KnowledgeSearchQuery {
  query: string;
  department?: string;
  kinds?: ("procedure" | "contact" | "guide")[];
  limit?: number;
}

export interface KnowledgeService {
  listSources(): Promise<KnowledgeSource[]>;
  /** French full-text search (websearch_to_tsquery + ts_rank_cd), enabled sources only; local contacts filtered to `department` (or national). */
  search(q: KnowledgeSearchQuery): Promise<KnowledgeHit[]>;
  /** Download + re-index one source. Throws on failure (and records lastError). Returns chunk count. */
  sync(sourceId: KnowledgeSourceId): Promise<number>;
  /** Full text of chunks (for the LLM prompt). */
  getChunks(ids: string[]): Promise<{ id: string; sourceId: KnowledgeSourceId; title: string; url: string | null; text: string }[]>;
}

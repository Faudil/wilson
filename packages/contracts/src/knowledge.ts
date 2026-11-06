import { z } from "zod";
import { TimestampSchema } from "./common.js";

/**
 * Knowledge base used to ground the "who to turn to" part of letter explanations (RAG).
 * Only sources whose licence allows reuse are enabled by default.
 */
export const KnowledgeSourceIdSchema = z.enum([
  "service_public", // Fiches pratiques Service-Public.fr — Licence Ouverte 2.0
  "annuaire", // Annuaire de l'administration (préfectures, CAF, CPAM, Point-justice…) — Licence Ouverte 2.0
  "association", // The association's own Markdown notes (knowledge/association/*.md)
  "watizat", // Watizat guides — "tous droits réservés": disabled until Watizat grants permission
]);
export type KnowledgeSourceId = z.infer<typeof KnowledgeSourceIdSchema>;

export const KnowledgeKindSchema = z.enum(["procedure", "contact", "guide"]);

export const KnowledgeSourceSchema = z.object({
  id: KnowledgeSourceIdSchema,
  name: z.string(),
  license: z.string(),
  homepage: z.url(),
  enabled: z.boolean(),
  /** Why a source is disabled (e.g. waiting for the publisher's permission). */
  disabledReason: z.string().nullable(),
  chunkCount: z.number().int(),
  lastSyncAt: TimestampSchema.nullable(),
  lastError: z.string().nullable(),
});
export type KnowledgeSource = z.infer<typeof KnowledgeSourceSchema>;

export const KnowledgeHitSchema = z.object({
  id: z.uuid(),
  sourceId: KnowledgeSourceIdSchema,
  kind: KnowledgeKindSchema,
  title: z.string(),
  url: z.string().nullable(),
  /** INSEE département code ("75", "2A", "971") for local contacts; null = national. */
  department: z.string().nullable(),
  excerpt: z.string(),
  score: z.number(),
});
export type KnowledgeHit = z.infer<typeof KnowledgeHitSchema>;

/** A source the orientation step actually used, shown to the reviewer next to the draft. */
export const LetterSourceRefSchema = z.object({
  chunkId: z.uuid(),
  sourceId: KnowledgeSourceIdSchema,
  title: z.string(),
  url: z.string().nullable(),
});
export type LetterSourceRef = z.infer<typeof LetterSourceRefSchema>;

export const KnowledgeSearchInputSchema = z.object({
  query: z.string().min(2).max(500),
  department: z.string().max(3).optional(),
  kinds: z.array(KnowledgeKindSchema).optional(),
  limit: z.number().int().min(1).max(20).default(8),
});

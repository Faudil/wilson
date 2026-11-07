/** pg-boss queue names and payloads — the contract between producers and workers. */
export const JOBS = {
  letterAnalyze: "letter.analyze",
  documentAnalyze: "document.analyze",
  waSend: "wa.send",
  remindersDispatch: "reminders.dispatch", // cron */15
  mediaPurge: "media.purge", // cron hourly: letter photos past PHOTO_TTL_HOURS
  archivePurge: "archive.purge", // cron daily: documents/beneficiaries past purge_at
  knowledgeSync: "knowledge.sync", // cron weekly + on demand
} as const;

export interface JobPayloads {
  [JOBS.letterAnalyze]: { letterId: string };
  [JOBS.documentAnalyze]: { documentId: string };
  /** Outbound text already rendered; the worker decides text vs template from the 24 h window. */
  [JOBS.waSend]:
    | { kind: "text"; beneficiaryId: string; body: string; letterId?: string; reminderId?: string }
    | { kind: "letter_reply"; letterId: string }
    /** Chatbot message already stored (encrypted, footer included) in `messages`; the worker sends it and marks it sent. */
    | { kind: "chat"; messageId: string };
  [JOBS.remindersDispatch]: { now?: string };
  [JOBS.mediaPurge]: Record<string, never>;
  [JOBS.archivePurge]: Record<string, never>;
  /** No sourceId = every enabled source. */
  [JOBS.knowledgeSync]: { sourceId?: "service_public" | "annuaire" | "association" | "watizat" };
}

export interface JobQueue {
  send<N extends keyof JobPayloads>(name: N, payload: JobPayloads[N], opts?: { singletonKey?: string; startAfter?: Date }): Promise<void>;
}

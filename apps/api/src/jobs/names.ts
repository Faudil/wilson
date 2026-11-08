/** pg-boss queue names and payloads — the contract between producers and workers. */
export const JOBS = {
  letterAnalyze: "letter.analyze",
  documentAnalyze: "document.analyze",
  waSend: "wa.send",
  remindersDispatch: "reminders.dispatch", // cron */15
  mediaPurge: "media.purge", // cron hourly: letter photos past PHOTO_TTL_HOURS
  archivePurge: "archive.purge", // cron daily: documents/beneficiaries past purge_at
  knowledgeSync: "knowledge.sync", // cron weekly + on demand
  broadcastDispatch: "broadcast.dispatch", // on approval: translate, create recipients, queue one wa.send each
  buddyDispatch: "buddy.dispatch", // cron */15: French practice buddies (next sessions, reminders, stale proposals)
  helpDispatch: "help.dispatch", // cron */15: Rendez-vous reminders, expiries, auto-done
} as const;

export interface JobPayloads {
  [JOBS.letterAnalyze]: { letterId: string };
  [JOBS.documentAnalyze]: { documentId: string };
  /** Outbound text already rendered; the worker decides text vs template from the 24 h window. */
  [JOBS.waSend]:
    /** interactive: a numbered menu, sent as WhatsApp buttons/list when it fits (see whatsapp/interactive.ts). */
    | { kind: "text"; beneficiaryId: string; body: string; letterId?: string; reminderId?: string; interactive?: boolean }
    | { kind: "letter_reply"; letterId: string }
    /** Chatbot message already stored (encrypted, footer included) in `messages`; the worker sends it and marks it sent. */
    | { kind: "chat"; messageId: string }
    /** One announcement to one person (row in broadcast_recipients): text in the window, else the template first. */
    | { kind: "broadcast"; broadcastId: string; beneficiaryId: string };
  [JOBS.broadcastDispatch]: { broadcastId: string };
  [JOBS.remindersDispatch]: { now?: string };
  [JOBS.mediaPurge]: Record<string, never>;
  [JOBS.helpDispatch]: { now?: string };
  [JOBS.archivePurge]: Record<string, never>;
  /** No sourceId = every enabled source. */
  [JOBS.buddyDispatch]: { now?: string };
  [JOBS.knowledgeSync]: { sourceId?: "service_public" | "annuaire" | "association" | "watizat" };
}

export interface JobQueue {
  send<N extends keyof JobPayloads>(name: N, payload: JobPayloads[N], opts?: { singletonKey?: string; startAfter?: Date }): Promise<void>;
  /** Only the in-process queue (local/sandbox/tests) has it: run what was just queued now. pg-boss workers run on their own. */
  drain?(): Promise<number>;
}

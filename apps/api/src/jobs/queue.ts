import { PgBoss } from "pg-boss";
import { JOBS, type JobPayloads, type JobQueue } from "./names.js";

export type JobHandler<N extends keyof JobPayloads> = (payload: JobPayloads[N]) => Promise<void>;

/** A queue that can also host workers (both PgBossQueue and InlineQueue). */
export interface WorkerQueue extends JobQueue {
  registerWorker<N extends keyof JobPayloads>(name: N, handler: JobHandler<N>): Promise<void>;
}

const ALL_QUEUES = Object.values(JOBS);

const CRONS: { name: (typeof JOBS)[keyof typeof JOBS]; cron: string }[] = [
  { name: JOBS.remindersDispatch, cron: "*/15 * * * *" },
  { name: JOBS.helpDispatch, cron: "*/15 * * * *" },
  { name: JOBS.mediaPurge, cron: "0 * * * *" },
  { name: JOBS.waitingAlert, cron: "5 * * * *" },
  { name: JOBS.archivePurge, cron: "0 3 * * *" },
  { name: JOBS.knowledgeSync, cron: "0 4 * * 1" }, // weekly, Monday 04:00
  { name: JOBS.buddyDispatch, cron: "*/15 * * * *" },
];

export class PgBossQueue implements WorkerQueue {
  private readonly boss: PgBoss;

  constructor(databaseUrl: string, private readonly timezone = "Europe/Paris") {
    this.boss = new PgBoss(databaseUrl);
    this.boss.on("error", (err) => console.error("[pg-boss]", err));
  }

  /** Installs pg-boss schema, creates queues and registers cron schedules. */
  async start(): Promise<void> {
    await this.boss.start();
    for (const name of ALL_QUEUES) await this.boss.createQueue(name);
    for (const { name, cron } of CRONS) await this.boss.schedule(name, cron, {}, { tz: this.timezone });
  }

  async stop(): Promise<void> {
    await this.boss.stop({ graceful: true });
  }

  async send<N extends keyof JobPayloads>(name: N, payload: JobPayloads[N], opts?: { singletonKey?: string; startAfter?: Date }): Promise<void> {
    await this.boss.send(name, payload as object, {
      retryLimit: 3,
      retryDelay: 30,
      retryBackoff: true,
      ...(opts?.singletonKey ? { singletonKey: opts.singletonKey } : {}),
      ...(opts?.startAfter ? { startAfter: opts.startAfter } : {}),
    });
  }

  async registerWorker<N extends keyof JobPayloads>(name: N, handler: JobHandler<N>): Promise<void> {
    await this.boss.work<JobPayloads[N]>(name, async (jobs) => {
      // Process sequentially; throwing fails the batch and pg-boss retries it.
      for (const job of jobs) await handler(job.data);
    });
  }
}

/** Test queue: records every job; `drain()` runs registered handlers synchronously until nothing is left. */
export class InlineQueue implements WorkerQueue {
  readonly sent: { name: keyof JobPayloads; payload: unknown; opts?: { singletonKey?: string; startAfter?: Date } }[] = [];
  private pending: { name: keyof JobPayloads; payload: unknown }[] = [];
  private readonly handlers = new Map<string, JobHandler<never>>();
  private readonly seenKeys = new Set<string>();

  async send<N extends keyof JobPayloads>(name: N, payload: JobPayloads[N], opts?: { singletonKey?: string; startAfter?: Date }): Promise<void> {
    if (opts?.singletonKey) {
      const k = `${name}:${opts.singletonKey}`;
      if (this.seenKeys.has(k)) return;
      this.seenKeys.add(k);
    }
    this.sent.push({ name, payload, opts });
    this.pending.push({ name, payload });
  }

  async registerWorker<N extends keyof JobPayloads>(name: N, handler: JobHandler<N>): Promise<void> {
    this.handlers.set(name, handler as JobHandler<never>);
  }

  jobs<N extends keyof JobPayloads>(name: N): JobPayloads[N][] {
    return this.sent.filter((j) => j.name === name).map((j) => j.payload as JobPayloads[N]);
  }

  /** Runs pending jobs that have a registered handler (including ones they enqueue). Jobs without handler stay recorded only. */
  async drain(): Promise<number> {
    let n = 0;
    while (this.pending.length) {
      const job = this.pending.shift()!;
      const h = this.handlers.get(job.name);
      if (!h) continue;
      await (h as (p: unknown) => Promise<void>)(job.payload);
      n++;
    }
    return n;
  }

  clear(): void {
    this.sent.length = 0;
    this.pending = [];
    this.seenKeys.clear();
  }
}

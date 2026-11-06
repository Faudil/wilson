import { JOBS, type JobPayloads } from "../jobs/names.js";
import type { JobHandler, WorkerQueue } from "../jobs/queue.js";

/**
 * Local runtime: in-process queue. Jobs run in the background right after `send` (one at a time),
 * with 3 retries; crons run on timers. Jobs are lost if the process stops — acceptable for local testing only.
 */
export class LocalQueue implements WorkerQueue {
  private readonly handlers = new Map<string, JobHandler<never>>();
  private readonly pending: { name: keyof JobPayloads; payload: unknown; attempts: number; notBefore: number }[] = [];
  private readonly singletons = new Set<string>();
  private running = false;
  private timers: NodeJS.Timeout[] = [];

  async send<N extends keyof JobPayloads>(name: N, payload: JobPayloads[N], opts?: { singletonKey?: string; startAfter?: Date }): Promise<void> {
    if (opts?.singletonKey) {
      const k = `${name}:${opts.singletonKey}`;
      if (this.singletons.has(k)) return;
      this.singletons.add(k);
    }
    this.pending.push({ name, payload, attempts: 0, notBefore: opts?.startAfter?.getTime() ?? 0 });
    setImmediate(() => void this.pump());
  }

  async registerWorker<N extends keyof JobPayloads>(name: N, handler: JobHandler<N>): Promise<void> {
    this.handlers.set(name, handler as JobHandler<never>);
  }

  start(): void {
    const every = (ms: number, name: keyof JobPayloads) =>
      this.timers.push(setInterval(() => void this.send(name, {} as never), ms));
    every(15 * 60_000, JOBS.remindersDispatch);
    every(60 * 60_000, JOBS.mediaPurge);
    every(24 * 60 * 60_000, JOBS.archivePurge);
    this.timers.push(setInterval(() => void this.pump(), 5_000));
  }

  async stop(): Promise<void> {
    this.timers.forEach(clearInterval);
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (;;) {
        const idx = this.pending.findIndex((j) => j.notBefore <= Date.now());
        if (idx < 0) break;
        const job = this.pending.splice(idx, 1)[0]!;
        const handler = this.handlers.get(job.name);
        if (!handler) continue;
        try {
          await (handler as (p: unknown) => Promise<void>)(job.payload);
        } catch (err) {
          console.error(`[queue] ${job.name} failed (attempt ${job.attempts + 1})`, err);
          if (job.attempts < 3) this.pending.push({ ...job, attempts: job.attempts + 1, notBefore: Date.now() + 2_000 * 2 ** job.attempts });
        }
      }
    } finally {
      this.running = false;
    }
  }
}

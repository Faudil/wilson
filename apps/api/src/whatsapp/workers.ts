import { JOBS } from "../jobs/names.js";
import type { WaDeps } from "./context.js";
import { runSendJob } from "./send.js";
import { getBroadcasts } from "../broadcasts/service.js";

/** Structurally compatible with jobs/queue.ts `WorkerQueue` (and a plain `registerWorker(name, handler)` fake). */
export interface WorkerRegistry {
  registerWorker(name: any, handler: (payload: any) => Promise<void>): void | Promise<void>;
}

export async function registerWhatsAppWorkers(deps: WaDeps, queue: WorkerRegistry): Promise<void> {
  await queue.registerWorker(JOBS.waSend, (p) => runSendJob(deps, p));
  await queue.registerWorker(JOBS.broadcastDispatch, (p: { broadcastId: string }) => getBroadcasts(deps).dispatch(p.broadcastId));
  await queue.registerWorker(JOBS.letterAnalyze, (p: { letterId: string }) => deps.letters.analyzeLetter(p.letterId));
  await queue.registerWorker(JOBS.mediaPurge, async () => {
    await deps.letters.purgeExpiredPhotos(deps.now());
  });
}

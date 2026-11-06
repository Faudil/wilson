import type { WaDeps } from "../whatsapp/context.js";
import { dispatchDueReminders } from "../documents/reminders.js";
import { purgeArchived } from "../documents/purge.js";
import { handleDocumentAnalyze } from "../documents/worker.js";
import { registerWhatsAppWorkers } from "../whatsapp/workers.js";
import { JOBS } from "./names.js";
import type { WorkerQueue } from "./queue.js";

/**
 * Registers every worker on the queue. Mine: document.analyze, reminders.dispatch, archive.purge.
 * The WhatsApp/letters batch registers letter.analyze, wa.send and media.purge in `registerWhatsAppWorkers`.
 */
export async function registerWorkers(deps: WaDeps, queue: WorkerQueue): Promise<void> {
  await queue.registerWorker(JOBS.documentAnalyze, (p) => handleDocumentAnalyze(deps, p));
  await queue.registerWorker(JOBS.remindersDispatch, async (p) => {
    await dispatchDueReminders(deps, p.now ? new Date(p.now) : deps.now());
  });
  await queue.registerWorker(JOBS.archivePurge, async () => {
    await purgeArchived(deps, deps.now());
  });
  await registerWhatsAppWorkers(deps, queue);
}

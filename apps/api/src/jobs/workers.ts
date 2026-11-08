import type { WaDeps } from "../whatsapp/context.js";
import { dispatchDueReminders } from "../documents/reminders.js";
import { purgeArchived } from "../documents/purge.js";
import { handleDocumentAnalyze } from "../documents/worker.js";
import { getNews } from "../team/news.js";
import { registerWhatsAppWorkers } from "../whatsapp/workers.js";
import { getServices } from "../services.js";
import { getBuddies } from "../buddies/service.js";
import { getAppointments } from "../appointments/service.js";
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
  await queue.registerWorker(JOBS.helpDispatch, async (p) => {
    await getAppointments(deps).dispatch(p.now ? new Date(p.now) : deps.now());
  });
  await queue.registerWorker(JOBS.archivePurge, async () => {
    await purgeArchived(deps, deps.now());
  });
  await queue.registerWorker(JOBS.knowledgeSync, async (p) => {
    const knowledge = getServices(deps).knowledge;
    if (p.sourceId) {
      await knowledge.sync(p.sourceId); // explicit request: throw so the queue retries
      return;
    }
    for (const s of await knowledge.listSources()) {
      if (!s.enabled) continue;
      try {
        await knowledge.sync(s.id);
      } catch (err) {
        console.error(`[knowledge] sync ${s.id} failed:`, (err as Error).message);
      }
    }
  });
  await queue.registerWorker(JOBS.buddyDispatch, async (p) => {
    await getBuddies(deps).dispatch(p.now ? new Date(p.now) : deps.now());
  });
  await queue.registerWorker(JOBS.newsEmail, async (p) => {
    await getNews(deps).sendEmails(p.postId);
  });
  await registerWhatsAppWorkers(deps, queue);
}

import { JOBS } from "../jobs/names.js";
import { getServices } from "../services.js";
import { os, requirePermission } from "./base.js";

export const knowledgeRouter = {
  sources: os.knowledge.sources.use(requirePermission("knowledge.view")).handler(({ context }) => getServices(context.deps).knowledge.listSources()),

  search: os.knowledge.search.use(requirePermission("knowledge.view")).handler(({ context, input }) =>
    getServices(context.deps).knowledge.search({ query: input.query, department: input.department, kinds: input.kinds, limit: input.limit }),
  ),

  sync: os.knowledge.sync.use(requirePermission("knowledge.manage")).handler(async ({ context, input }) => {
    await context.deps.jobs.send(JOBS.knowledgeSync, { sourceId: input.sourceId });
    return { queued: true };
  }),
};

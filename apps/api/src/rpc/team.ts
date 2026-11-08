import { getBackup } from "../team/backup.js";
import { getNews } from "../team/news.js";
import { logAccess } from "./logAccess.js";
import { guard, os, requirePermission } from "./base.js";

const readNews = requirePermission("news.view");
const postNews = requirePermission("news.post");
const viewBackup = requirePermission("backup.view");
const askBackup = requirePermission("backup.ask");

/** Team news. The audience rules (own association, global admins everywhere) live in team/news.ts. */
export const newsRouter = {
  list: os.news.list.use(readNews).handler(({ input, context }) => getNews(context.deps).list(context.volunteer, input.limit)),
  unread: os.news.unread.use(readNews).handler(({ context }) => getNews(context.deps).unread(context.volunteer)),
  markRead: os.news.markRead.use(readNews).handler(({ input, context }) => getNews(context.deps).markRead(context.volunteer, input.ids)),

  create: os.news.create.use(postNews).handler(async ({ input, context }) => {
    const p = await guard(() => getNews(context.deps).create(context.volunteer, input));
    await logAccess(context, "news.create", p.id);
    return p;
  }),
  update: os.news.update.use(postNews).handler(async ({ input, context }) => {
    const p = await guard(() => getNews(context.deps).update(context.volunteer, input));
    await logAccess(context, "news.update", p.id);
    return p;
  }),
  remove: os.news.remove.use(postNews).handler(async ({ input, context }) => {
    await guard(() => getNews(context.deps).remove(context.volunteer, input.id));
    await logAccess(context, "news.remove", input.id);
  }),
};

/** Calls for backup between volunteers. Who sees and who closes: team/backup.ts. */
export const backupRouter = {
  list: os.backup.list.use(viewBackup).handler(({ input, context }) => getBackup(context.deps).list(context.volunteer, input.scope)),
  counts: os.backup.counts.use(viewBackup).handler(({ context }) => getBackup(context.deps).counts(context.volunteer)),
  create: os.backup.create.use(askBackup).handler(({ input, context }) => guard(() => getBackup(context.deps).create(context.volunteer, input))),
  offer: os.backup.offer.use(viewBackup).handler(({ input, context }) => guard(() => getBackup(context.deps).offer(context.volunteer, input.id, input.note))),
  withdraw: os.backup.withdraw.use(viewBackup).handler(({ input, context }) => guard(() => getBackup(context.deps).withdraw(context.volunteer, input.id))),
  close: os.backup.close.use(viewBackup).handler(({ input, context }) => guard(() => getBackup(context.deps).close(context.volunteer, input.id, input.status))),
};

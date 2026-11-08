import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { NewsInput, NewsPost, Volunteer } from "@wilson/contracts";
import { associations, newsPosts, newsReads } from "../db/schema.js";
import type { Deps } from "../deps.js";
import { DomainError } from "../errors.js";
import { JOBS } from "../jobs/names.js";
import { getMailer } from "../mail.js";
import { activeHolders, associationNames, isGlobalAdmin, sameAssociation, volunteerNames } from "./scope.js";

type Row = typeof newsPosts.$inferSelect;
type NewsDeps = Pick<Deps, "db" | "config" | "now" | "jobs">;

export class NewsError extends DomainError {
  constructor(code: "NOT_FOUND" | "FORBIDDEN") {
    super(code);
    this.name = "NewsError";
  }
}

/** May `v` write a post for this audience (null = everyone)? Global admins anywhere, others their own association. */
export function canPostTo(v: Volunteer, associationId: string | null): boolean {
  if (!v.permissions.includes("news.post")) return false;
  if (isGlobalAdmin(v)) return true;
  return associationId !== null && sameAssociation(v, associationId);
}

/** Who reads a post: people with news.view in its association, or everyone for a post to everyone. Not the author. */
async function audience(deps: NewsDeps, r: Pick<Row, "associationId" | "authorId">) {
  const all = await activeHolders(deps.db, "news.view", { associationId: r.associationId, everyone: r.associationId === null });
  return all.filter((a) => a.id !== r.authorId);
}

const MAIL_FOOTER: Record<"fr" | "en" | "ar", (link: string) => string> = {
  fr: (l) => `—\nPublié dans l'espace bénévoles. Pour le lire ou répondre à l'équipe : ${l}`,
  en: (l) => `—\nPosted in the volunteers' space. Read it there: ${l}`,
  ar: (l) => `—\nنُشر في مساحة المتطوعين. اقرأه هناك: ${l}`,
};

export function createNewsService(deps: NewsDeps) {
  const { db } = deps;

  const visible = (v: Volunteer) =>
    isGlobalAdmin(v) ? isNull(newsPosts.removedAt)
    : and(isNull(newsPosts.removedAt), v.association ? or(isNull(newsPosts.associationId), eq(newsPosts.associationId, v.association.id)) : isNull(newsPosts.associationId));

  async function toPosts(rows: Row[], v: Volunteer): Promise<NewsPost[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [assoc, authors, mine] = await Promise.all([
      associationNames(db, rows.map((r) => r.associationId)),
      volunteerNames(db, rows.map((r) => r.authorId)),
      db.select({ postId: newsReads.postId }).from(newsReads).where(and(eq(newsReads.volunteerId, v.id), inArray(newsReads.postId, ids))),
    ]);
    const read = new Set(mine.map((m) => m.postId));
    const editable = (r: Row) => canPostTo(v, r.associationId) || (r.authorId === v.id && v.permissions.includes("news.post"));
    // Read counts only for the people who can edit (one audience query per association involved).
    const audiences = new Map<string, Set<string>>();
    const seenBy = new Map<string, Set<string>>();
    const counted = rows.filter(editable);
    if (counted.length) {
      for (const r of counted) {
        const key = `${r.associationId ?? "*"}:${r.authorId ?? ""}`;
        if (!audiences.has(key)) audiences.set(key, new Set((await audience(deps, r)).map((a) => a.id)));
      }
      for (const x of await db.select({ postId: newsReads.postId, volunteerId: newsReads.volunteerId }).from(newsReads).where(inArray(newsReads.postId, counted.map((r) => r.id)))) {
        if (!seenBy.has(x.postId)) seenBy.set(x.postId, new Set());
        seenBy.get(x.postId)!.add(x.volunteerId);
      }
    }
    return rows.map((r) => {
      const canEdit = editable(r);
      const aud = canEdit ? audiences.get(`${r.associationId ?? "*"}:${r.authorId ?? ""}`)! : null;
      const seen = aud ? [...(seenBy.get(r.id) ?? [])].filter((id) => aud.has(id)).length : 0;
      return {
        id: r.id, title: r.title, body: r.body, pinned: r.pinned,
        association: r.associationId ? { id: r.associationId, name: assoc.get(r.associationId) ?? "" } : null,
        authorName: r.authorId ? (authors.get(r.authorId) ?? null) : null,
        createdAt: r.createdAt.toISOString(), editedAt: r.editedAt?.toISOString() ?? null,
        read: read.has(r.id) || r.authorId === v.id,
        canEdit,
        reads: aud ? { seen, audience: aud.size } : null,
        emailedAt: r.emailedAt?.toISOString() ?? null,
      };
    });
  }

  async function mustEditable(id: string, v: Volunteer): Promise<Row> {
    const [r] = await db.select().from(newsPosts).where(and(eq(newsPosts.id, id), visible(v))).limit(1);
    if (!r) throw new NewsError("NOT_FOUND");
    if (!canPostTo(v, r.associationId) && !(r.authorId === v.id && v.permissions.includes("news.post"))) throw new NewsError("FORBIDDEN");
    return r;
  }

  return {
    async list(v: Volunteer, limit: number): Promise<NewsPost[]> {
      const rows = await db.select().from(newsPosts).where(visible(v)).orderBy(desc(newsPosts.pinned), desc(newsPosts.createdAt)).limit(limit);
      return toPosts(rows, v);
    },

    async unread(v: Volunteer): Promise<{ count: number; latest: NewsPost[] }> {
      const where = and(visible(v), sql`(${newsPosts.authorId} is null or ${newsPosts.authorId} <> ${v.id})`,
        sql`not exists (select 1 from ${newsReads} where ${newsReads.postId} = ${newsPosts.id} and ${newsReads.volunteerId} = ${v.id})`);
      // Global admins see every association's posts, but only the ones meant for them count as unread.
      const forMe = isGlobalAdmin(v) ? and(where, v.association ? or(isNull(newsPosts.associationId), eq(newsPosts.associationId, v.association.id)) : isNull(newsPosts.associationId)) : where;
      const [c] = await db.select({ n: sql<number>`count(*)::int` }).from(newsPosts).where(forMe);
      const rows = await db.select().from(newsPosts).where(forMe).orderBy(desc(newsPosts.pinned), desc(newsPosts.createdAt)).limit(3);
      return { count: c?.n ?? 0, latest: await toPosts(rows, v) };
    },

    async markRead(v: Volunteer, ids: string[]): Promise<void> {
      const ok = await db.select({ id: newsPosts.id }).from(newsPosts).where(and(inArray(newsPosts.id, [...new Set(ids)]), visible(v)));
      if (ok.length === 0) return;
      await db.insert(newsReads).values(ok.map((p) => ({ postId: p.id, volunteerId: v.id, readAt: deps.now() }))).onConflictDoNothing();
    },

    async create(v: Volunteer, input: NewsInput): Promise<NewsPost> {
      const target = input.associationId === undefined ? (isGlobalAdmin(v) ? null : (v.association?.id ?? null)) : input.associationId;
      if (!canPostTo(v, target)) throw new NewsError("FORBIDDEN");
      if (target) {
        const [a] = await db.select({ id: associations.id }).from(associations).where(eq(associations.id, target)).limit(1);
        if (!a) throw new NewsError("NOT_FOUND");
      }
      const email = input.email && !!getMailer(deps);
      const [r] = await db.insert(newsPosts).values({
        title: input.title, body: input.body, pinned: input.pinned, associationId: target, authorId: v.id,
        createdAt: deps.now(), emailedAt: email ? deps.now() : null,
      }).returning();
      if (email) await deps.jobs.send(JOBS.newsEmail, { postId: r!.id });
      return (await toPosts([r!], v))[0]!;
    },

    async update(v: Volunteer, input: { id: string; title: string; body: string; pinned: boolean }): Promise<NewsPost> {
      const old = await mustEditable(input.id, v);
      const textChanged = old.title !== input.title || old.body !== input.body;
      const [r] = await db.update(newsPosts)
        .set({ title: input.title, body: input.body, pinned: input.pinned, ...(textChanged ? { editedAt: deps.now() } : {}) })
        .where(eq(newsPosts.id, input.id)).returning();
      return (await toPosts([r!], v))[0]!;
    },

    async remove(v: Volunteer, id: string): Promise<void> {
      await mustEditable(id, v);
      await db.update(newsPosts).set({ removedAt: deps.now() }).where(eq(newsPosts.id, id));
    },

    /** Worker for JOBS.newsEmail: one e-mail per reader, best effort (a failed address does not stop the others). */
    async sendEmails(postId: string): Promise<number> {
      const mailer = getMailer(deps);
      const [r] = await db.select().from(newsPosts).where(and(eq(newsPosts.id, postId), isNull(newsPosts.removedAt))).limit(1);
      if (!mailer || !r) return 0;
      const link = `${deps.config.PUBLIC_BACKOFFICE_ORIGIN.replace(/\/$/, "")}/#/news`;
      let sent = 0;
      for (const a of await audience(deps, r)) {
        const lang = a.uiLanguage === "fr" || a.uiLanguage === "ar" ? a.uiLanguage : "en";
        try {
          await mailer.send(a.email, `[${deps.config.ASSOCIATION_NAME}] ${r.title}`, `${r.body}\n\n${MAIL_FOOTER[lang](link)}`);
          sent++;
        } catch (e) {
          console.warn("[news] e-mail failed:", e instanceof Error ? e.message : String(e));
        }
      }
      return sent;
    },
  };
}

export type NewsService = ReturnType<typeof createNewsService>;
const cache = new WeakMap<object, NewsService>();
export function getNews(deps: NewsDeps): NewsService {
  let s = cache.get(deps);
  if (!s) cache.set(deps, (s = createNewsService(deps)));
  return s;
}

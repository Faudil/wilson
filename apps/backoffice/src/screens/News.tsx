import type { NewsPost } from "@wilson/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Chip } from "../components/badges";
import { Icon } from "../components/Icon";
import { ConfirmSheet, Empty, ErrorBox, OverflowMenu, Sheet, Skeleton, useToast } from "../components/ui";
import { useI18n } from "../i18n";
import { orpc } from "../lib/api";
import { relativeTime } from "../lib/relative";
import { useSession } from "../lib/session";

type Draft = { title: string; body: string; pinned: boolean; email: boolean; audience: string };
/** audience: "own" = the poster's association, "all" = everyone, else an association id (global admins). */

function ComposeSheet({ edit, onClose }: { edit: NewsPost | null; onClose: () => void }) {
  const { t } = useI18n();
  const { volunteer, can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const global = can("volunteers.manage");
  const health = useQuery({ ...orpc.system.health.queryOptions(), staleTime: 60_000 });
  const assocs = useQuery({ ...orpc.associations.list.queryOptions(), enabled: global && !edit && can("associations.manage") });
  const [d, setD] = useState<Draft>(edit
    ? { title: edit.title, body: edit.body, pinned: edit.pinned, email: false, audience: "own" }
    : { title: "", body: "", pinned: false, email: false, audience: global ? "all" : "own" });
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const done = () => {
    toast(edit ? t("news.savedToast") : t("news.postedToast"));
    void qc.invalidateQueries({ queryKey: orpc.news.key() });
    onClose();
  };
  const create = useMutation({ ...orpc.news.create.mutationOptions(), onSuccess: done });
  const update = useMutation({ ...orpc.news.update.mutationOptions(), onSuccess: done });
  const valid = d.title.trim().length >= 2 && d.body.trim().length > 0;
  const error = create.error ?? update.error;
  const emailOn = !!health.data?.emailVerification;
  return (
    <Sheet open onClose={onClose} title={edit ? t("news.edit") : t("news.compose")}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          if (edit) update.mutate({ id: edit.id, title: d.title.trim(), body: d.body.trim(), pinned: d.pinned });
          else create.mutate({
            title: d.title.trim(), body: d.body.trim(), pinned: d.pinned, email: emailOn && d.email,
            associationId: d.audience === "all" ? null : d.audience === "own" ? undefined : d.audience,
          });
        }}
      >
        {!edit && (
          global ? (
            <label className="field">
              <span className="field-label">{t("news.audience")}</span>
              <select value={d.audience} onChange={(e) => set("audience", e.target.value)}>
                <option value="all">{t("news.audience.all")}</option>
                {assocs.data?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
          ) : (
            <p className="sheet-text">{t("news.audienceOwn", { name: volunteer.association?.name ?? "" })}</p>
          )
        )}
        <label className="field">
          <span className="field-label">{t("news.titleLabel")}</span>
          <input value={d.title} onChange={(e) => set("title", e.target.value)} maxLength={120} placeholder={t("news.titlePlaceholder")} dir="auto" required />
        </label>
        <label className="field">
          <span className="field-label">{t("news.body")}</span>
          <textarea value={d.body} onChange={(e) => set("body", e.target.value)} maxLength={4000} rows={7} placeholder={t("news.bodyPlaceholder")} dir="auto" required />
          <small className="muted">{t("news.bodyHelp")}</small>
        </label>
        <label className="check">
          <input type="checkbox" checked={d.pinned} onChange={(e) => set("pinned", e.target.checked)} />
          <span>
            {t("news.pin")}
            <small className="muted block">{t("news.pinHelp")}</small>
          </span>
        </label>
        {!edit && emailOn && (
          <label className="check">
            <input type="checkbox" checked={d.email} onChange={(e) => set("email", e.target.checked)} />
            <span>
              {t("news.email")}
              <small className="muted block">{t("news.emailHelp")}</small>
            </span>
          </label>
        )}
        {error && <ErrorBox error={error} />}
        <div className="stack-tight">
          <button type="submit" className="btn btn-block btn-primary" disabled={!valid || create.isPending || update.isPending}>
            <Icon name={edit ? "check" : "send"} size={18} />
            {edit ? t("vol.save") : t("news.publish")}
          </button>
          <button type="button" className="btn btn-block btn-quiet" onClick={onClose}>
            {t("common.cancel")}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

export function NewsCardItem({ post, onEdit, onRemove, onPin }: { post: NewsPost; onEdit?: () => void; onRemove?: () => void; onPin?: () => void }) {
  const { t, lang } = useI18n();
  return (
    <article className={`card news-card${post.read ? "" : " is-unread"}`}>
      <div className="row between">
        <div className="stack-tight grow">
          <div className="chips">
            {!post.read && <Chip tone="warn">{t("news.new")}</Chip>}
            {post.pinned && <Chip tone="info">{t("news.pinned")}</Chip>}
            <Chip tone="muted" icon={post.association ? "building" : "users"}>{post.association?.name ?? t("news.audience.all")}</Chip>
          </div>
          <h2 className="card-title" dir="auto">{post.title}</h2>
        </div>
        {post.canEdit && onEdit && onRemove && onPin && (
          <OverflowMenu label={t("news.actions")}>
            {(close) => (
              <>
                <button type="button" role="menuitem" onClick={() => { close(); onEdit(); }}>
                  <Icon name="edit" size={18} />
                  {t("news.edit")}
                </button>
                <button type="button" role="menuitem" onClick={() => { close(); onPin(); }}>
                  <Icon name="pin" size={18} />
                  {post.pinned ? t("news.unpin") : t("news.pin")}
                </button>
                <button type="button" role="menuitem" onClick={() => { close(); onRemove(); }}>
                  <Icon name="trash" size={18} />
                  {t("news.remove")}
                </button>
              </>
            )}
          </OverflowMenu>
        )}
      </div>
      <p className="news-body" dir="auto">{post.body}</p>
      <p className="muted small">
        {post.authorName ? t("news.byWhen", { name: post.authorName, when: relativeTime(post.createdAt, lang) }) : relativeTime(post.createdAt, lang)}
        {post.editedAt && ` · ${t("news.edited")}`}
      </p>
      {post.reads && (
        <p className="news-reads small">
          <Icon name="eye" size={16} />
          {t("news.seenBy", { seen: post.reads.seen, total: post.reads.audience })}
          {post.emailedAt && <span className="muted"> · {t("news.emailed")}</span>}
        </p>
      )}
    </article>
  );
}

/** Actualités: what the association tells its volunteers. Opening the screen marks what is shown as read. */
export function News() {
  const { t } = useI18n();
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ ...orpc.news.list.queryOptions({ input: {} }), refetchInterval: 5 * 60_000 });
  const [sheet, setSheet] = useState<{ edit: NewsPost | null } | null>(null);
  const [removing, setRemoving] = useState<NewsPost | null>(null);
  const markRead = useMutation({ ...orpc.news.markRead.mutationOptions(), onSuccess: () => void qc.invalidateQueries({ queryKey: orpc.news.unread.key() }) });
  const pin = useMutation({ ...orpc.news.update.mutationOptions(), onSuccess: () => void qc.invalidateQueries({ queryKey: orpc.news.key() }) });
  const remove = useMutation({
    ...orpc.news.remove.mutationOptions(),
    onSuccess: () => {
      toast(t("news.removedToast"));
      setRemoving(null);
      void qc.invalidateQueries({ queryKey: orpc.news.key() });
    },
  });
  // Keep the "new" marks on screen for this visit; the server knows they are read.
  const unreadIds = q.data?.filter((p) => !p.read).map((p) => p.id).join(",") ?? "";
  useEffect(() => {
    if (unreadIds) markRead.mutate({ ids: unreadIds.split(",") });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadIds]);
  const canPost = can("news.post");

  return (
    <section className="stack">
      <div className="row between wrap">
        <h1>{t("news.title")}</h1>
        {canPost && (
          <button type="button" className="btn btn-small btn-primary" onClick={() => setSheet({ edit: null })}>
            <Icon name="plus" size={16} />
            {t("news.compose")}
          </button>
        )}
      </div>
      <p className="muted">{t("news.intro")}</p>
      {q.isPending && <Skeleton lines={3} />}
      {q.isError && <ErrorBox error={q.error} retry={() => void q.refetch()} />}
      {(remove.error ?? pin.error) && <ErrorBox error={remove.error ?? pin.error} />}
      {q.isSuccess && q.data.length === 0 && <Empty art="book" sub={canPost ? t("news.emptySub") : undefined}>{t("news.empty")}</Empty>}
      <ul className="cards">
        {q.data?.map((p) => (
          <li key={p.id}>
            <NewsCardItem
              post={p}
              onEdit={() => setSheet({ edit: p })}
              onRemove={() => setRemoving(p)}
              onPin={() => pin.mutate({ id: p.id, title: p.title, body: p.body, pinned: !p.pinned })}
            />
          </li>
        ))}
      </ul>
      {sheet && <ComposeSheet edit={sheet.edit} onClose={() => setSheet(null)} />}
      <ConfirmSheet
        open={removing !== null}
        title={t("news.removeTitle")}
        body={t("news.removeBody", { title: removing?.title ?? "" })}
        confirmLabel={t("news.remove")}
        tone="danger"
        busy={remove.isPending}
        onConfirm={() => removing && remove.mutate({ id: removing.id })}
        onClose={() => setRemoving(null)}
      />
    </section>
  );
}

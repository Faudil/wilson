import type { QuickReply } from "@wilson/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useI18n } from "../i18n";
import { orpc } from "../lib/api";
import { useSession } from "../lib/session";
import { Icon } from "./Icon";
import { Empty, ErrorBox, Sheet, Skeleton, useToast } from "./ui";

/**
 * Saved answers for the composer. Picking one puts its French text in the reply box: the volunteer can still change
 * it, and it is translated on send like anything they type. Admins (`replies.manage`) curate the list here.
 */
export function QuickRepliesSheet({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (text: string) => void }) {
  const { t } = useI18n();
  const session = useSession();
  const [managing, setManaging] = useState(false);
  const list = useQuery({ ...orpc.quickReplies.list.queryOptions(), enabled: open, staleTime: 60_000 });
  const canManage = session.can("replies.manage");
  return (
    <Sheet open={open} onClose={onClose} title={managing ? t("qr.manageTitle") : t("qr.title")}>
      {list.isPending && <Skeleton lines={3} card={false} />}
      {list.isError && <ErrorBox error={list.error} retry={() => void list.refetch()} />}
      {list.data && !managing && (
        <div className="stack">
          {list.data.length === 0 ? (
            <Empty art="chat" sub={canManage ? t("qr.emptyAdmin") : t("qr.emptySub")}>
              {t("qr.empty")}
            </Empty>
          ) : (
            <ul className="qr-list">
              {list.data.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    className="qr-item"
                    onClick={() => {
                      onPick(r.text);
                      onClose();
                    }}
                  >
                    <strong>{r.title}</strong>
                    <span className="small muted" lang="fr">
                      {r.text}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="small muted">
            <Icon name="globe" size={12} /> {t("qr.hint")}
          </p>
          {canManage && (
            <button type="button" className="btn btn-block btn-quiet" onClick={() => setManaging(true)}>
              <Icon name="edit" size={18} />
              {t("qr.manage")}
            </button>
          )}
        </div>
      )}
      {list.data && managing && <ManageQuickReplies replies={list.data} onBack={() => setManaging(false)} />}
    </Sheet>
  );
}

function ManageQuickReplies({ replies, onBack }: { replies: QuickReply[]; onBack: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState<QuickReply | "new" | null>(null);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const refresh = () => void qc.invalidateQueries({ queryKey: orpc.quickReplies.key() });
  const saved = () => {
    toast(t("qr.savedToast"));
    setEditing(null);
    refresh();
  };
  const create = useMutation({ ...orpc.quickReplies.create.mutationOptions(), onSuccess: saved });
  const update = useMutation({ ...orpc.quickReplies.update.mutationOptions(), onSuccess: saved });
  const remove = useMutation({
    ...orpc.quickReplies.remove.mutationOptions(),
    onSuccess: () => {
      toast(t("qr.removedToast"), "info");
      setEditing(null);
      refresh();
    },
  });
  const busy = create.isPending || update.isPending || remove.isPending;
  const error = create.error ?? update.error ?? remove.error;
  const start = (r: QuickReply | "new") => {
    setEditing(r);
    setTitle(r === "new" ? "" : r.title);
    setText(r === "new" ? "" : r.text);
  };

  if (editing) {
    return (
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          const input = { title: title.trim(), text: text.trim() };
          if (editing === "new") create.mutate(input);
          else update.mutate({ ...input, id: editing.id });
        }}
      >
        <p className="small muted">{t("qr.legalNote")}</p>
        <label className="field">
          <span className="field-label">{t("qr.fieldTitle")}</span>
          <input required maxLength={40} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">{t("qr.fieldText")}</span>
          <textarea required rows={4} maxLength={1000} lang="fr" dir="ltr" value={text} onChange={(e) => setText(e.target.value)} />
        </label>
        {error && (
          <div className="notice notice-error" role="alert">
            <Icon name="alert" />
            <span className="notice-body">{t("error.generic")}</span>
          </div>
        )}
        <div className="stack-tight">
          <button type="submit" className="btn btn-block btn-primary" disabled={busy || !title.trim() || !text.trim()}>
            <Icon name="check" size={18} />
            {t("qr.save")}
          </button>
          {editing !== "new" && (
            <button type="button" className="btn btn-block btn-danger-quiet" disabled={busy} onClick={() => remove.mutate({ id: editing.id })}>
              <Icon name="trash" size={18} />
              {t("qr.remove")}
            </button>
          )}
          <button type="button" className="btn btn-block btn-quiet" onClick={() => setEditing(null)}>
            {t("common.cancel")}
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className="stack">
      <p className="small muted">{t("qr.legalNote")}</p>
      <ul className="qr-list">
        {replies.map((r) => (
          <li key={r.id}>
            <button type="button" className="qr-item" onClick={() => start(r)}>
              <strong>
                <Icon name="edit" size={14} /> {r.title}
              </strong>
              <span className="small muted" lang="fr">
                {r.text}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <div className="stack-tight">
        <button type="button" className="btn btn-block btn-primary" onClick={() => start("new")}>
          <Icon name="plus" size={18} />
          {t("qr.add")}
        </button>
        <button type="button" className="btn btn-block btn-quiet" onClick={onBack}>
          {t("qr.back")}
        </button>
      </div>
    </div>
  );
}

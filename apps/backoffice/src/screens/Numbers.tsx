import type { HeldNumber } from "@wilson/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Chip, LangBadge } from "../components/badges";
import { Icon } from "../components/Icon";
import { ConfirmSheet, Empty, ErrorBox, Skeleton, useToast } from "../components/ui";
import { useI18n, type MessageKey } from "../i18n";
import { orpc } from "../lib/api";
import { href } from "../lib/router";
import { useSession } from "../lib/session";
import { formatDate } from "../lib/wilson-i18n";
import { Segmented } from "./Queue";

type Status = HeldNumber["status"];

/** Numbers held by the WhatsApp flood guard, and blocked numbers (numbers.moderate). */
export function Numbers() {
  const { t, lang } = useI18n();
  const session = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<Status>("quarantined");
  const [blocking, setBlocking] = useState<HeldNumber | null>(null);
  const list = useQuery({ ...orpc.numbers.list.queryOptions({ input: { status } }), refetchInterval: 30_000 });
  const done = (message: string) => () => {
    toast(message);
    setBlocking(null);
    void qc.invalidateQueries({ queryKey: orpc.numbers.key() });
  };
  const release = useMutation({ ...orpc.numbers.release.mutationOptions(), onSuccess: done(t("num.releasedToast")) });
  const releaseAll = useMutation({ ...orpc.numbers.releaseAllGlobal.mutationOptions(), onSuccess: done(t("num.releasedToast")) });
  const block = useMutation({ ...orpc.numbers.block.mutationOptions(), onSuccess: done(t("num.blockedToast")) });
  const unblock = useMutation({ ...orpc.numbers.unblock.mutationOptions(), onSuccess: done(t("num.unblockedToast")) });
  const busy = release.isPending || releaseAll.isPending || block.isPending || unblock.isPending;
  const error = release.error ?? releaseAll.error ?? block.error ?? unblock.error;
  const items = list.data?.items ?? [];
  const globalHeld = items.filter((i) => i.reason === "global_flood").length;

  return (
    <section className="stack">
      <h1>{t("num.title")}</h1>
      <p className="muted">{t("num.intro")}</p>
      {list.data?.floodMode && (
        <div className="notice notice-warn" role="status">
          <Icon name="alert" size={20} />
          <span className="notice-body">{t("num.floodMode")}</span>
        </div>
      )}
      <Segmented
        label={t("num.filter")}
        value={status}
        onChange={setStatus}
        options={(["quarantined", "blocked"] as Status[]).map((s) => ({ value: s, label: t(`num.filter.${s}` as MessageKey) }))}
      />
      {list.isPending && <Skeleton lines={3} />}
      {list.isError && <ErrorBox error={list.error} retry={() => void list.refetch()} />}
      {error && <ErrorBox error={error} />}
      {status === "quarantined" && globalHeld > 1 && (
        <button type="button" className="btn btn-block" disabled={busy} onClick={() => releaseAll.mutate(undefined)}>
          <Icon name="undo" size={18} />
          {t("num.releaseAll", { n: globalHeld })}
        </button>
      )}
      {list.isSuccess && items.length === 0 && <Empty art="done">{t(`num.empty.${status}` as MessageKey)}</Empty>}
      <ul className="cards">
        {items.map((n) => (
          <li key={n.beneficiaryId}>
            <div className={`card${n.status === "quarantined" ? " is-attention" : ""}`}>
              <div className="row wrap">
                <strong className="card-title" dir="ltr">
                  {n.label}
                </strong>
                <LangBadge language={n.language} />
              </div>
              <div className="chips">
                <Chip tone={n.status === "blocked" ? "error" : "warn"} icon="shield">
                  {t(`num.reason.${n.reason}` as MessageKey)}
                </Chip>
                {n.knownBefore && <Chip tone="info">{t("num.known")}</Chip>}
              </div>
              {n.lastText && (
                <p className="vol-note" dir="auto" lang={n.language}>
                  {n.lastText}
                </p>
              )}
              <p className="muted small">
                {t("num.since", { date: formatDate(n.since.slice(0, 10), lang) })} · {t("num.messages", { n: n.totalMessages })}
              </p>
              <div className="row wrap">
                {n.status === "quarantined" ? (
                  <>
                    <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => release.mutate({ beneficiaryId: n.beneficiaryId })}>
                      <Icon name="check" size={16} />
                      {t("num.release")}
                    </button>
                    <button type="button" className="btn btn-small btn-danger-quiet" disabled={busy} onClick={() => setBlocking(n)}>
                      <Icon name="x" size={16} />
                      {t("num.block")}
                    </button>
                  </>
                ) : (
                  <button type="button" className="btn btn-small" disabled={busy} onClick={() => unblock.mutate({ beneficiaryId: n.beneficiaryId })}>
                    <Icon name="undo" size={16} />
                    {t("num.unblock")}
                  </button>
                )}
                {session.can("conversations.view") && (
                  <a className="btn btn-small btn-quiet" href={href("conversations", n.beneficiaryId)}>
                    <Icon name="chat" size={16} />
                    {t("nav.conversations")}
                  </a>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
      <BlockSheet number={blocking} busy={busy} onConfirm={(id) => block.mutate({ beneficiaryId: id })} onClose={() => setBlocking(null)} />
    </section>
  );
}

export function BlockSheet({ number, busy, onConfirm, onClose }: { number: { beneficiaryId: string } | null; busy: boolean; onConfirm: (id: string) => void; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <ConfirmSheet
      open={number !== null}
      title={t("num.blockTitle")}
      body={t("num.blockBody")}
      confirmLabel={t("num.block")}
      tone="danger"
      busy={busy}
      onConfirm={() => number && onConfirm(number.beneficiaryId)}
      onClose={onClose}
    />
  );
}

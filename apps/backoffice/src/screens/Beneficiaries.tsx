import type { DocumentDto, LanguageCode } from "@wilson/contracts";
import { LANGUAGES, LANGUAGE_CODES, DOCUMENT_TYPES } from "@wilson/contracts/values";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Chip, Countdown, LangBadge, StatusBadge, UrgencyBadge } from "../components/badges";
import { Avatar, labelDir } from "../components/Avatar";
import { AvatarSheet } from "../components/AvatarSheet";
import { Icon } from "../components/Icon";
import { DateField } from "../components/DateField";
import { BackLink, ConfirmSheet, Empty, ErrorBox, OverflowMenu, Skeleton, useToast } from "../components/ui";
import { useI18n, type MessageKey } from "../i18n";
import { client, orpc } from "../lib/api";
import { href } from "../lib/router";
import { useSession } from "../lib/session";
import { CaseFilePanel } from "./CaseFile";
import { documentTypeName, formatDate } from "../lib/wilson-i18n";
import { daysBetween, todayParis } from "../lib/format";
import { relativeTime } from "../lib/relative";
import { daysHint } from "../components/badges";

export function BeneficiaryList() {
  const { t, lang } = useI18n();
  const [input, setInput] = useState("");
  const [search, setSearch] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setSearch(input.trim()), 300);
    return () => clearTimeout(id);
  }, [input]);

  const query = useInfiniteQuery(
    orpc.beneficiaries.list.infiniteOptions({
      input: (cursor: string | undefined) => ({ cursor, limit: 20, search: search || undefined }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (last) => last.nextCursor ?? undefined,
    }),
  );
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <section className="stack">
      <h1>{t("beneficiaries.title")}</h1>
      <label className="search">
        <span className="visually-hidden">{t("beneficiaries.search")}</span>
        <Icon name="search" size={20} />
        <input type="search" inputMode="numeric" maxLength={40} value={input} placeholder={t("beneficiaries.searchPlaceholder")} onChange={(e) => setInput(e.target.value)} dir="ltr" />
      </label>
      {query.isPending && <Skeleton lines={3} />}
      {query.isError && <ErrorBox error={query.error} retry={() => void query.refetch()} />}
      {query.isSuccess && items.length === 0 && <Empty art="search">{search ? t("beneficiaries.noResults") : t("beneficiaries.empty")}</Empty>}
      <ul className="cards">
        {items.map((b) => (
          <li key={b.id}>
            <a className="card card-link person-card" href={href("beneficiaries", b.id)}>
              <Avatar avatar={b.avatar} seed={b.id} size={44} />
              <span className="person-main">
                <span className="card-top">
                  <strong className="card-title" dir={labelDir(b.label)}>
                    {b.label}
                  </strong>
                  <LangBadge language={b.language} />
                </span>
                <span className="muted small">
                  {t("beneficiaries.documentCount", { count: b.documentCount })}
                  {" · "}
                  {b.nextExpiry ? t("beneficiaries.nextExpiry", { date: formatDate(b.nextExpiry, lang) }) : t("beneficiaries.noExpiry")}
                </span>
                {b.nextExpiry && <Countdown date={b.nextExpiry} />}
              </span>
              <Icon name="chevron" size={20} className="card-chevron" />
            </a>
          </li>
        ))}
      </ul>
      {query.hasNextPage && (
        <button type="button" className="btn btn-block" onClick={() => void query.fetchNextPage()} disabled={query.isFetchingNextPage}>
          {t("common.more")}
        </button>
      )}
    </section>
  );
}

export function BeneficiaryDetail({ id }: { id: string }) {
  const { t, lang } = useI18n();
  const { can } = useSession();
  const qc = useQueryClient();
  const query = useQuery(orpc.beneficiaries.get.queryOptions({ input: { id } }));
  const [editAvatar, setEditAvatar] = useState(false);
  const setLanguage = useMutation({
    ...orpc.beneficiaries.setLanguage.mutationOptions(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: orpc.beneficiaries.key() });
    },
  });

  return (
    <section className="stack">
      <BackLink to={href("beneficiaries")}>{t("nav.beneficiaries")}</BackLink>
      {query.isPending && <Skeleton lines={3} />}
      {query.isError && <ErrorBox error={query.error} retry={() => void query.refetch()} />}
      {query.isSuccess && (
        <>
          <header className="chat-head">
            {can("beneficiaries.edit") ? (
              <button type="button" className="who-edit" onClick={() => setEditAvatar(true)} aria-label={t("avatar.edit")} title={t("avatar.edit")}>
                <Avatar avatar={query.data.avatar} seed={query.data.id} size={56} />
                <span className="who-edit-badge" aria-hidden="true">
                  <Icon name="edit" size={12} />
                </span>
              </button>
            ) : (
              <Avatar avatar={query.data.avatar} seed={query.data.id} size={56} />
            )}
            <div className="chat-head-main">
              <h1 dir={labelDir(query.data.label)} className="start">
                {query.data.label}
              </h1>
              {can("beneficiaries.edit") && !query.data.avatar?.name && (
                <button type="button" className="link-btn small" onClick={() => setEditAvatar(true)}>
                  {t("avatar.giveName")}
                </button>
              )}
              <div className="chips">
                <LangBadge language={query.data.language} />
                <span className="muted small">
                  {query.data.lastMessageAt ? t("beneficiaries.lastMessage", { date: relativeTime(query.data.lastMessageAt, lang) }) : t("beneficiaries.noMessages")}
                </span>
              </div>
            </div>
            {can("conversations.view") && (
              <a className="icon-btn" href={href("conversations", id)} aria-label={t("beneficiaries.openChat")}>
                <Icon name="chat" />
              </a>
            )}
          </header>
          <AvatarSheet open={editAvatar} onClose={() => setEditAvatar(false)} id={id} avatar={query.data.avatar} />

          {can("beneficiaries.edit") && (
            <label className="field card">
              <span className="field-label">{t("beneficiaries.language")}</span>
              <select
                value={query.data.language}
                disabled={setLanguage.isPending}
                onChange={(e) => setLanguage.mutate({ id, language: e.target.value as LanguageCode })}
              >
                {LANGUAGE_CODES.map((code) => (
                  <option key={code} value={code} lang={code} dir={LANGUAGES[code].dir}>
                    {LANGUAGES[code].nativeName}
                  </option>
                ))}
              </select>
              {setLanguage.isError && <small className="notice notice-error">{t("error.generic")}</small>}
              <small className="muted">{t("beneficiaries.languageHelp")}</small>
            </label>
          )}

          {(can("notes.view") || can("notes.write")) && <CaseFilePanel beneficiaryId={id} />}

          <h2 className="section-title">{t("beneficiaries.documents")}</h2>
          {can("documents.view_metadata") ? (
            query.data.documents.length === 0 ? (
              <Empty art="letters">{t("beneficiaries.noDocuments")}</Empty>
            ) : (
              <ul className="cards">
                {query.data.documents.map((d) => (
                  <li key={d.id}>
                    <DocumentCard doc={d} />
                  </li>
                ))}
              </ul>
            )
          ) : (
            <p className="muted">{t("error.forbidden")}</p>
          )}

          <h2 className="section-title">{t("beneficiaries.letters")}</h2>
          {query.data.letters.length === 0 ? (
            <Empty art="letters">{t("beneficiaries.noLetters")}</Empty>
          ) : (
            <ul className="cards">
              {query.data.letters.map((l) => (
                <li key={l.id}>
                  <a className="card card-link" href={href("letters", l.id)}>
                    <strong className="card-title">{l.letterType ? t(`letterType.${l.letterType}` as MessageKey) : t("queue.typeUnknown")}</strong>
                    <div className="chips">
                      <StatusBadge status={l.status} />
                      <UrgencyBadge urgency={l.urgency} />
                      {l.deadline && <Countdown date={l.deadline} />}
                    </div>
                    <Icon name="chevron" size={20} className="card-chevron" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function DocumentCard({ doc }: { doc: DocumentDto }) {
  const { t, lang } = useI18n();
  const { can } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [confirmArchive, setConfirmArchive] = useState(false);
  const archive = useMutation({
    ...orpc.documents.archive.mutationOptions(),
    onSuccess: () => {
      setConfirmArchive(false);
      toast(t("documents.archivedToast"));
      void qc.invalidateQueries({ queryKey: orpc.beneficiaries.key() });
      void qc.invalidateQueries({ queryKey: orpc.documents.key() });
    },
  });
  const [editing, setEditing] = useState(false);
  const [type, setType] = useState(doc.type);
  const [noExpiry, setNoExpiry] = useState(doc.expiresAt === null);
  const [date, setDate] = useState(doc.expiresAt ?? "");
  const update = useMutation({
    ...orpc.documents.update.mutationOptions(),
    onSuccess: () => {
      setEditing(false);
      toast(t("documents.saved"));
      void qc.invalidateQueries({ queryKey: orpc.beneficiaries.key() });
      void qc.invalidateQueries({ queryKey: orpc.documents.key() });
    },
  });
  const startEdit = () => {
    setType(doc.type);
    setNoExpiry(doc.expiresAt === null);
    setDate(doc.expiresAt ?? "");
    update.reset();
    setEditing(true);
  };
  const dateOk = noExpiry || /^\d{4}-\d{2}-\d{2}$/.test(date);
  const saveEdit = () => {
    const expiresAt = noExpiry ? null : date;
    update.mutate({
      id: doc.id,
      ...(type !== doc.type ? { type } : {}),
      ...(expiresAt !== doc.expiresAt ? { expiresAt } : {}),
    });
  };
  const [opening, setOpening] = useState(false);
  const [fileError, setFileError] = useState(false);

  const openFile = async () => {
    setOpening(true);
    setFileError(false);
    try {
      const file = await client.documents.file({ id: doc.id });
      const url = URL.createObjectURL(file);
      window.open(url, "_blank", "noopener");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      setFileError(true);
    } finally {
      setOpening(false);
    }
  };

  const archived = doc.archivedAt !== null;
  const left = doc.expiresAt ? daysBetween(todayParis(), doc.expiresAt) : null;
  const fill = left === null ? 0 : Math.max(4, Math.min(100, Math.round((left / 365) * 100)));
  const tone = left === null ? "ok" : left < 0 || left <= 7 ? "urgent" : left <= 30 ? "warn" : "ok";
  const canView = can("documents.view_file");
  const canEdit = can("documents.edit") && !archived;
  return (
    <div className={`card doc-card ${archived ? "is-archived" : ""}`}>
      <div className="card-top">
        <span className="doc-title">
          <span className="doc-icon">
            <Icon name="file" size={20} />
          </span>
          <span>
            <strong className="card-title">{documentTypeName(doc.type, lang)}</strong>
            {doc.label && <span className="muted small doc-label">{doc.label}</span>}
          </span>
        </span>
        {(canView || canEdit) && (
          <OverflowMenu label={t("beneficiaries.moreActions")}>
            {(close) => (
              <>
                {canView && (
                  <button type="button" role="menuitem" disabled={opening} onClick={() => { close(); void openFile(); }}>
                    <Icon name="eye" size={18} />
                    {t("documents.view")}
                  </button>
                )}
                {canEdit && !editing && (
                  <button type="button" role="menuitem" onClick={() => { close(); startEdit(); }}>
                    <Icon name="edit" size={18} />
                    {t("documents.edit")}
                  </button>
                )}
                {canEdit && (
                  <button type="button" role="menuitem" className="menu-danger" onClick={() => { close(); setConfirmArchive(true); }}>
                    <Icon name="archive" size={18} />
                    {t("documents.archive")}
                  </button>
                )}
              </>
            )}
          </OverflowMenu>
        )}
      </div>
      {doc.expiresAt && left !== null ? (
        <div className="expiry">
          <div className="expiry-row">
            <span className="muted small">
              {t("documents.expires")} <strong className="expiry-date">{formatDate(doc.expiresAt, lang, { weekday: true })}</strong>
            </span>
            <Chip tone={tone} icon="clock">
              {left < 0 ? t("documents.expired") + " · " + daysHint(t, left) : daysHint(t, left)}
            </Chip>
          </div>
          <div className={`meter meter-${tone}`} role="img" aria-label={`${t("documents.validity")}: ${daysHint(t, left)}`}>
            <span style={{ inlineSize: `${left < 0 ? 100 : fill}%` }} />
          </div>
        </div>
      ) : (
        <span className="muted small">{t("documents.noExpiry")}</span>
      )}
      {doc.reminders.length > 0 && (
        <div className="reminders">
          <span className="muted small field-label">
            <Icon name="bell" size={14} /> {t("documents.reminders")}
          </span>
          <ol className="mini-timeline">
            {doc.reminders.map((r) => (
              <li key={r.id} className={`rem rem-${r.status}`}>
                <span className="rem-dot" aria-hidden="true" />
                <span>{t(`reminder.${r.kind}` as MessageKey)}</span>
                <span className="muted small">{t(`reminderState.${r.status}` as MessageKey)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
      {archived && doc.purgeAt && (
        <div className="notice notice-info small">
          <Icon name="info" size={16} />
          <span className="notice-body">{t("documents.archivedUntil", { date: formatDate(doc.purgeAt.slice(0, 10), lang) })}</span>
        </div>
      )}
      {editing && canEdit && (
        <fieldset className="stack fix-panel" disabled={update.isPending}>
          <label className="field">
            <span className="field-label">{t("documents.type")}</span>
            <select value={type} onChange={(e) => setType(e.target.value as DocumentDto["type"])}>
              {DOCUMENT_TYPES.map((o) => (
                <option key={o} value={o}>
                  {documentTypeName(o, lang)}
                </option>
              ))}
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={noExpiry} onChange={(e) => setNoExpiry(e.target.checked)} />
            <span>{t("documents.noExpiryCheck")}</span>
          </label>
          {!noExpiry && <DateField label={t("documents.expiryDate")} value={date} onChange={setDate} previewKey="documents.datePreview" />}
          <div className="row wrap">
            <button type="button" className="btn btn-primary" disabled={!dateOk} onClick={saveEdit}>
              {t("documents.saveEdit")}
            </button>
            <button type="button" className="btn btn-quiet" onClick={() => setEditing(false)}>
              {t("common.cancel")}
            </button>
          </div>
        </fieldset>
      )}
      {update.isError && <p className="notice notice-error small">{t("error.generic")}</p>}
      {fileError && <p className="notice notice-error small">{t("error.generic")}</p>}
      {archive.isError && <p className="notice notice-error small">{t("error.generic")}</p>}
      <ConfirmSheet
        open={confirmArchive}
        title={t("documents.archiveTitle")}
        body={t("documents.confirmArchive")}
        confirmLabel={t("documents.archiveYes")}
        tone="danger"
        busy={archive.isPending}
        onConfirm={() => archive.mutate({ id: doc.id })}
        onClose={() => setConfirmArchive(false)}
      />
    </div>
  );
}

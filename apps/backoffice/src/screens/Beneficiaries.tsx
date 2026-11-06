import { LANGUAGES, LANGUAGE_CODES, DocumentTypeSchema, type DocumentDto, type LanguageCode } from "@wilson/contracts";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { DeadlineText, LangBadge, StatusBadge, UrgencyBadge } from "../components/badges";
import { DateField } from "../components/DateField";
import { BackLink, Empty, ErrorBox, Loading } from "../components/ui";
import { useI18n, type MessageKey } from "../i18n";
import { client, orpc } from "../lib/api";
import { href } from "../lib/router";
import { useSession } from "../lib/session";
import { documentTypeName, formatDate, formatDateTime } from "../lib/wilson-i18n";

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
    <section>
      <h1>{t("beneficiaries.title")}</h1>
      <label className="field">
        <span>{t("beneficiaries.search")}</span>
        <input type="search" inputMode="numeric" maxLength={40} value={input} onChange={(e) => setInput(e.target.value)} dir="ltr" />
      </label>
      {query.isPending && <Loading />}
      {query.isError && <ErrorBox error={query.error} retry={() => void query.refetch()} />}
      {query.isSuccess && items.length === 0 && <Empty>{t("beneficiaries.empty")}</Empty>}
      <ul className="cards">
        {items.map((b) => (
          <li key={b.id}>
            <a className="card card-link" href={href("beneficiaries", b.id)}>
              <div className="row wrap">
                <strong dir="ltr">{b.label}</strong>
                <LangBadge language={b.language} />
              </div>
              <div className="muted">{t("beneficiaries.documentCount", { count: b.documentCount })}</div>
              <div className="muted small">
                {b.nextExpiry ? t("beneficiaries.nextExpiry", { date: formatDate(b.nextExpiry, lang) }) : t("beneficiaries.noExpiry")}
              </div>
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
  const setLanguage = useMutation({
    ...orpc.beneficiaries.setLanguage.mutationOptions(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: orpc.beneficiaries.key() });
    },
  });

  return (
    <section className="stack">
      <BackLink to={href("beneficiaries")}>{t("nav.beneficiaries")}</BackLink>
      {query.isPending && <Loading />}
      {query.isError && <ErrorBox error={query.error} retry={() => void query.refetch()} />}
      {query.isSuccess && (
        <>
          <header className="stack-tight">
            <h1 dir="ltr" className="start">
              {query.data.label}
            </h1>
            <div className="row wrap">
              <LangBadge language={query.data.language} />
              <span className="muted small">
                {query.data.lastMessageAt ? t("beneficiaries.lastMessage", { date: formatDateTime(query.data.lastMessageAt, lang) }) : ""}
              </span>
            </div>
          </header>

          {can("beneficiaries.edit") && (
            <label className="field">
              <span>{t("beneficiaries.language")}</span>
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

          <h2>{t("beneficiaries.documents")}</h2>
          {can("documents.view_metadata") ? (
            query.data.documents.length === 0 ? (
              <Empty>{t("beneficiaries.noDocuments")}</Empty>
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

          <h2>{t("beneficiaries.letters")}</h2>
          {query.data.letters.length === 0 ? (
            <Empty>{t("beneficiaries.noLetters")}</Empty>
          ) : (
            <ul className="cards">
              {query.data.letters.map((l) => (
                <li key={l.id}>
                  <a className="card card-link" href={href("letters", l.id)}>
                    <div className="row wrap">
                      <StatusBadge status={l.status} />
                      <UrgencyBadge urgency={l.urgency} />
                    </div>
                    <strong>{l.letterType ? t(`letterType.${l.letterType}` as MessageKey) : t("queue.typeUnknown")}</strong>
                    {l.deadline && <DeadlineText date={l.deadline} />}
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
  const archive = useMutation({
    ...orpc.documents.archive.mutationOptions(),
    onSuccess: () => {
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
  return (
    <div className={`card ${archived ? "is-archived" : ""}`}>
      <strong className="card-title">{documentTypeName(doc.type, lang)}</strong>
      {doc.label && <div>{doc.label}</div>}
      <div>
        {doc.expiresAt ? (
          <>
            <span className="muted">{t("documents.expires")} </span>
            <DeadlineText date={doc.expiresAt} />
          </>
        ) : (
          <span className="muted">{t("documents.noExpiry")}</span>
        )}
      </div>
      <div className="muted small">
        {t("documents.remindersLine", {
          list:
            doc.reminders.length === 0
              ? t("documents.noReminders")
              : doc.reminders.map((r) => `${t(`reminder.${r.kind}` as MessageKey)} ${t(`reminderStatus.${r.status}` as MessageKey)}`).join(" · "),
        })}
      </div>
      {archived && doc.purgeAt && <div className="notice notice-info small">{t("documents.archivedUntil", { date: formatDate(doc.purgeAt.slice(0, 10), lang) })}</div>}
      <div className="row wrap">
        {can("documents.view_file") && (
          <button type="button" className="btn" onClick={() => void openFile()} disabled={opening}>
            {t("documents.view")}
          </button>
        )}
        {can("documents.edit") && !archived && !editing && (
          <button type="button" className="btn" onClick={startEdit}>
            {t("documents.edit")}
          </button>
        )}
        {can("documents.edit") && !archived && (
          <button
            type="button"
            className="btn btn-danger-quiet"
            disabled={archive.isPending}
            onClick={() => {
              if (window.confirm(t("documents.confirmArchive"))) archive.mutate({ id: doc.id });
            }}
          >
            {t("documents.archive")}
          </button>
        )}
      </div>
      {editing && can("documents.edit") && !archived && (
        <fieldset className="stack" disabled={update.isPending}>
          <label className="field">
            <span>{t("documents.type")}</span>
            <select value={type} onChange={(e) => setType(e.target.value as DocumentDto["type"])}>
              {DocumentTypeSchema.options.map((o) => (
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
            <button type="button" className="btn" onClick={() => setEditing(false)}>
              {t("common.cancel")}
            </button>
          </div>
        </fieldset>
      )}
      {update.isSuccess && !editing && <p className="notice notice-ok small">{t("documents.saved")}</p>}
      {update.isError && <p className="notice notice-error small">{t("error.generic")}</p>}
      {fileError && <p className="notice notice-error small">{t("error.generic")}</p>}
      {archive.isError && <p className="notice notice-error small">{t("error.generic")}</p>}
    </div>
  );
}

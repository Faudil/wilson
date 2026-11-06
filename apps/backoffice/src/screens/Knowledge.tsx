import type { KnowledgeSource } from "@wilson/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Empty, ErrorBox, Loading } from "../components/ui";
import { useI18n, type MessageKey } from "../i18n";
import { orpc } from "../lib/api";
import { useSession } from "../lib/session";
import { formatDateTime } from "../lib/wilson-i18n";

function SourceCard({ source, canSync }: { source: KnowledgeSource; canSync: boolean }) {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const sync = useMutation({
    ...orpc.knowledge.sync.mutationOptions(),
    onSuccess: () => qc.invalidateQueries({ queryKey: orpc.knowledge.sources.key() }),
  });
  return (
    <li className="card stack-tight">
      <div className="row between wrap">
        <strong className="card-title">{t(`knowledge.source.${source.id}` as MessageKey)}</strong>
        <span className={`badge ${source.enabled ? "badge-ok" : "badge-muted"}`}>{source.enabled ? t("knowledge.enabled") : t("knowledge.disabled")}</span>
      </div>
      {!source.enabled && source.disabledReason && (
        <p className="small" lang="fr" dir="ltr">
          {source.disabledReason}
        </p>
      )}
      <p className="muted small">
        <span lang="fr" dir="ltr">
          {t("knowledge.license", { license: source.license })}
        </span>
        {" · "}
        {t("knowledge.chunks", { n: source.chunkCount })}
      </p>
      <p className="muted small">
        {source.lastSyncAt ? t("knowledge.lastSync", { date: formatDateTime(source.lastSyncAt, lang) }) : t("knowledge.neverSynced")}
      </p>
      {source.lastError && (
        <p className="notice notice-error small" lang="fr" dir="ltr">
          {t("knowledge.lastError", { error: source.lastError })}
        </p>
      )}
      {canSync && (
        <div className="row wrap">
          <button type="button" className="btn btn-small" disabled={sync.isPending || !source.enabled} onClick={() => sync.mutate({ sourceId: source.id })}>
            {sync.isPending ? t("knowledge.syncing") : t("knowledge.sync")}
          </button>
          {sync.isSuccess && <span className="muted small">{t("knowledge.syncQueued")}</span>}
        </div>
      )}
      {sync.isError && <ErrorBox error={sync.error} />}
    </li>
  );
}

function SearchBox() {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [department, setDepartment] = useState("75");
  const search = useMutation(orpc.knowledge.search.mutationOptions());
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (query.trim().length < 2) return;
    search.mutate({ query: query.trim(), department: department.trim() || undefined, limit: 8 });
  };
  return (
    <section className="stack">
      <h2>{t("knowledge.searchTitle")}</h2>
      <form className="stack" onSubmit={submit}>
        <label className="field">
          <span>{t("knowledge.searchLabel")}</span>
          <input type="search" value={query} maxLength={500} onChange={(e) => setQuery(e.target.value)} lang="fr" dir="ltr" />
        </label>
        <label className="field">
          <span>{t("knowledge.departmentLabel")}</span>
          <input value={department} maxLength={3} onChange={(e) => setDepartment(e.target.value)} dir="ltr" inputMode="text" />
        </label>
        <button type="submit" className="btn btn-primary" disabled={search.isPending || query.trim().length < 2}>
          {t("knowledge.searchButton")}
        </button>
      </form>
      {search.isPending && <Loading />}
      {search.isError && <ErrorBox error={search.error} />}
      {search.isSuccess && search.data.length === 0 && <Empty>{t("knowledge.noHits")}</Empty>}
      <ul className="cards">
        {search.data?.map((h) => (
          <li key={h.id} className="card stack-tight">
            <strong className="card-title" lang="fr" dir="ltr">
              {h.title}
            </strong>
            <span className="muted small">
              {t(`knowledge.kind.${h.kind}` as MessageKey)} · {t(`knowledge.source.${h.sourceId}` as MessageKey)}
              {h.department ? ` · ${h.department}` : ""}
            </span>
            <p className="small" lang="fr" dir="ltr">
              {h.excerpt}
            </p>
            {h.url && (
              <a href={h.url} target="_blank" rel="noopener noreferrer">
                {t("knowledge.openLink")}
              </a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function Knowledge() {
  const { t } = useI18n();
  const session = useSession();
  const sources = useQuery(orpc.knowledge.sources.queryOptions());
  return (
    <section className="stack">
      <h1>{t("knowledge.title")}</h1>
      <p className="muted">{t("knowledge.intro")}</p>
      {sources.isPending && <Loading />}
      {sources.isError && <ErrorBox error={sources.error} retry={() => void sources.refetch()} />}
      <ul className="cards">
        {sources.data?.map((s) => (
          <SourceCard key={s.id} source={s} canSync={session.can("knowledge.manage")} />
        ))}
      </ul>
      <SearchBox />
    </section>
  );
}

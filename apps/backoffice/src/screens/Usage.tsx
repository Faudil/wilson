import type { LanguageCode, UsageBudget, UsageSummary, UsageTotals } from "@wilson/contracts";
import { LANGUAGES } from "@wilson/contracts/values";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Icon } from "../components/Icon";
import { ErrorBox, Sheet, Skeleton, useToast } from "../components/ui";
import { useI18n, type MessageKey } from "../i18n";
import { orpc } from "../lib/api";
import { formatDate } from "../lib/wilson-i18n";
import { ApiKeys } from "./ApiKeys";
import { BudgetNotice } from "../components/BudgetNotice";

/** USD, the currency Anthropic bills in. Small amounts keep 3 decimals so a few cents stay visible. */
export function usd(n: number, lang: LanguageCode): string {
  const digits = n > 0 && n < 1 ? 3 : 2;
  return new Intl.NumberFormat(lang, { style: "currency", currency: "USD", minimumFractionDigits: digits, maximumFractionDigits: digits }).format(n);
}
const int = (n: number, lang: LanguageCode) => new Intl.NumberFormat(lang).format(n);
const compact = (n: number, lang: LanguageCode) => new Intl.NumberFormat(lang, { notation: "compact", maximumFractionDigits: 1 }).format(n);

function Stat({ label, totals, lang, sub }: { label: string; totals: UsageTotals; lang: LanguageCode; sub?: string }) {
  const { t } = useI18n();
  return (
    <div className="card usage-stat">
      <span className="muted small">{label}</span>
      <strong className="usage-amount">{usd(totals.costUsd, lang)}</strong>
      <span className="muted small">{sub ?? t("usage.calls", { n: int(totals.calls, lang) })}</span>
    </div>
  );
}

function DaysChart({ days, lang }: { days: UsageSummary["days"]; lang: LanguageCode }) {
  const { t } = useI18n();
  const max = Math.max(...days.map((d) => d.costUsd), 0);
  return (
    <div className="card stack-tight">
      <h2>{t("usage.days.title")}</h2>
      {max === 0 ? (
        <p className="muted">{t("usage.days.empty")}</p>
      ) : (
        <>
          <p className="muted small">{t("usage.days.max", { amount: usd(max, lang) })}</p>
          <div className="usage-bars" role="list" aria-label={t("usage.days.title")}>
            {days.map((d) => {
              const label = `${formatDate(d.date, lang)} : ${usd(d.costUsd, lang)} · ${t("usage.calls", { n: d.calls })}`;
              return (
                <span key={d.date} role="listitem" className="usage-bar" title={label} aria-label={label} tabIndex={0}>
                  <span style={{ blockSize: `${max ? Math.max((d.costUsd / max) * 100, d.costUsd > 0 ? 3 : 0) : 0}%` }} />
                </span>
              );
            })}
          </div>
          <div className="row between muted small" aria-hidden="true">
            <span>{formatDate(days[0]!.date, lang)}</span>
            <span>{formatDate(days.at(-1)!.date, lang)}</span>
          </div>
        </>
      )}
    </div>
  );
}

function Breakdown({ title, rows, name, lang }: { title: string; rows: (UsageTotals & { key: string })[]; name: (key: string) => string; lang: LanguageCode }) {
  const { t } = useI18n();
  if (!rows.length) return null;
  const total = rows.reduce((s, r) => s + r.costUsd, 0);
  return (
    <div className="card stack-tight">
      <h2>{title}</h2>
      <table className="usage-table">
        <thead>
          <tr>
            <th scope="col">{t("usage.col.what")}</th>
            <th scope="col">{t("usage.col.calls")}</th>
            <th scope="col">{t("usage.col.tokens")}</th>
            <th scope="col">{t("usage.col.cost")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <th scope="row">
                <span dir="auto">{name(r.key)}</span>
                <span className="meter" aria-hidden="true">
                  <span style={{ inlineSize: `${total > 0 ? (r.costUsd / total) * 100 : 0}%` }} />
                </span>
              </th>
              <td>{int(r.calls, lang)}</td>
              <td title={`${int(r.inputTokens, lang)} / ${int(r.outputTokens, lang)}`}>{compact(r.inputTokens + r.outputTokens, lang)}</td>
              <td>{r.unpricedCalls === r.calls ? "—" : usd(r.costUsd, lang)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BudgetSheet({ open, onClose, budget }: { open: boolean; onClose: () => void; budget: UsageBudget }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [limit, setLimit] = useState(budget.monthlyLimitUsd === null ? "" : String(budget.monthlyLimitUsd));
  const [hardStop, setHardStop] = useState(budget.hardStop);
  const save = useMutation({
    ...orpc.usage.setBudget.mutationOptions(),
    onSuccess: () => {
      toast(t("usage.budget.saved"));
      void qc.invalidateQueries({ queryKey: orpc.usage.key() });
      onClose();
    },
  });
  const parsed = limit.trim() === "" ? null : Number(limit.replace(",", "."));
  const invalid = parsed !== null && (!Number.isFinite(parsed) || parsed < 0);
  return (
    <Sheet open={open} onClose={onClose} title={t("usage.budget.edit")}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (!invalid) save.mutate({ monthlyLimitUsd: parsed, hardStop: parsed === null ? false : hardStop });
        }}
      >
        <p className="sheet-text">{t("usage.budget.help")}</p>
        <label className="field">
          <span className="field-label">{t("usage.budget.limit")}</span>
          <input inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder={t("usage.budget.none")} dir="ltr" aria-invalid={invalid} />
        </label>
        <label className="check">
          <input type="checkbox" checked={hardStop} disabled={parsed === null} onChange={(e) => setHardStop(e.target.checked)} />
          <span>{t("usage.budget.hardStop")}</span>
        </label>
        <p className="muted small">{t("usage.budget.hardStopHelp")}</p>
        {save.error && <ErrorBox error={save.error} />}
        <div className="stack-tight">
          <button type="submit" className="btn btn-block btn-primary" disabled={invalid || save.isPending}>
            {t("usage.budget.save")}
          </button>
          <button type="button" className="btn btn-block btn-quiet" onClick={onClose}>
            {t("common.cancel")}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

export function Usage() {
  const { t, lang } = useI18n();
  const q = useQuery({ ...orpc.usage.summary.queryOptions(), refetchInterval: 120_000 });
  const [editing, setEditing] = useState(false);

  if (q.isPending) return <Skeleton lines={4} />;
  if (q.isError) return <ErrorBox error={q.error} retry={() => void q.refetch()} />;
  const s = q.data;
  const b = s.budget;
  const taskName = (k: string) => t(`usage.task.${k}` as MessageKey);
  const langName = (k: string) => (k === "none" ? t("usage.lang.none") : (LANGUAGES[k as keyof typeof LANGUAGES]?.nativeName ?? k));

  return (
    <section className="stack">
      <h1>{t("usage.title")}</h1>
      <p className="muted">{t("usage.intro")}</p>
      {s.fakeMode && (
        <p className="notice">
          <Icon name="info" size={20} />
          <span className="notice-body">{t("usage.fakeMode")}</span>
        </p>
      )}
      <BudgetNotice budget={b} />

      <div className="usage-stats">
        <Stat label={t("usage.today")} totals={s.today} lang={lang} />
        <Stat label={t("usage.thisMonth")} totals={s.thisMonth} lang={lang} sub={t("usage.projected", { amount: usd(s.projectedMonthUsd, lang) })} />
        <Stat label={t("usage.lastMonth")} totals={s.lastMonth} lang={lang} />
      </div>

      <div className="card stack-tight">
        <div className="row between wrap">
          <h2>{t("usage.budget.title")}</h2>
          <button type="button" className="btn btn-small" onClick={() => setEditing(true)}>
            <Icon name="edit" size={16} />
            {t("usage.budget.edit")}
          </button>
        </div>
        {b.monthlyLimitUsd === null ? (
          <p className="muted">{t("usage.budget.noneSet")}</p>
        ) : (
          <>
            <p>{t("usage.budget.used", { used: usd(s.thisMonth.costUsd, lang), limit: usd(b.monthlyLimitUsd, lang), pct: Math.round(b.usedPercent ?? 0) })}</p>
            <span
              className={`meter${b.state === "over" ? " meter-urgent" : b.state === "warning" ? " meter-warn" : ""}`}
              role="img"
              aria-label={t("usage.budget.used", { used: usd(s.thisMonth.costUsd, lang), limit: usd(b.monthlyLimitUsd, lang), pct: Math.round(b.usedPercent ?? 0) })}
            >
              <span style={{ inlineSize: `${Math.min(b.usedPercent ?? 0, 100)}%` }} />
            </span>
            <p className="muted small">{b.hardStop ? t("usage.budget.stopOn") : t("usage.budget.stopOff")}</p>
          </>
        )}
        {s.perConversationUsd !== null && <p className="muted small">{t("usage.perConversation", { amount: usd(s.perConversationUsd, lang) })}</p>}
      </div>

      <ApiKeys />

      <DaysChart days={s.days} lang={lang} />
      <Breakdown title={t("usage.byTask")} rows={s.byTask} name={taskName} lang={lang} />
      <Breakdown title={t("usage.byLanguage")} rows={s.byLanguage} name={langName} lang={lang} />
      <Breakdown title={t("usage.byModel")} rows={s.byModel} name={(k) => k} lang={lang} />
      {s.thisMonth.unpricedCalls > 0 && <p className="muted small">{t("usage.unpriced", { n: s.thisMonth.unpricedCalls })}</p>}
      <p className="muted small">{t("usage.footnote")}</p>

      {editing && <BudgetSheet open={editing} onClose={() => setEditing(false)} budget={b} />}
    </section>
  );
}

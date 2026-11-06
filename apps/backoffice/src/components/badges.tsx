import { LANGUAGES, type LanguageCode, type LetterStatus, type LetterSummary } from "@wilson/contracts";
import { useI18n, type MessageKey } from "../i18n";
import { formatDate } from "../lib/wilson-i18n";
import { daysBetween, todayParis } from "../lib/format";

export function LangBadge({ language }: { language: LanguageCode }) {
  const l = LANGUAGES[language];
  return (
    <span className="badge badge-lang" lang={language} dir={l.dir}>
      {l.nativeName}
    </span>
  );
}

export function UrgencyBadge({ urgency }: { urgency: LetterSummary["urgency"] }) {
  const { t } = useI18n();
  if (!urgency) return null;
  return <span className={`badge badge-urgency-${urgency}`}>{t(`urgency.${urgency}` as MessageKey)}</span>;
}

export function StatusBadge({ status }: { status: LetterStatus }) {
  const { t } = useI18n();
  return <span className={`badge badge-status-${status}`}>{t(`status.${status}` as MessageKey)}</span>;
}

/** Deadline written out in the UI language, with days left. */
export function DeadlineText({ date }: { date: string }) {
  const { t, lang } = useI18n();
  const left = daysBetween(todayParis(), date);
  const hint = left < 0 ? t("deadline.passed", { days: -left }) : left === 0 ? t("deadline.today") : t("deadline.inDays", { days: left });
  return (
    <span>
      {formatDate(date, lang, { weekday: true })} <span className="muted">({hint})</span>
    </span>
  );
}

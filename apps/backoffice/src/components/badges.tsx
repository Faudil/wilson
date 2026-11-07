import type { LanguageCode, LetterStatus, LetterSummary } from "@wilson/contracts";
import { LANGUAGES } from "@wilson/contracts/values";
import { useI18n, type MessageKey } from "../i18n";
import { formatDate } from "../lib/wilson-i18n";
import { daysBetween, todayParis } from "../lib/format";
import { Icon, type IconName } from "./Icon";

export function LangBadge({ language }: { language: LanguageCode }) {
  const l = LANGUAGES[language];
  return (
    <span className="pill pill-lang" lang={language} dir={l.dir}>
      {l.nativeName}
    </span>
  );
}

export function Chip({ tone, icon, children }: { tone: "ok" | "warn" | "urgent" | "info" | "muted" | "error"; icon?: IconName; children: React.ReactNode }) {
  return (
    <span className={`chip chip-${tone}`}>
      {icon && <Icon name={icon} size={14} />}
      {children}
    </span>
  );
}

export function UrgencyBadge({ urgency }: { urgency: LetterSummary["urgency"] }) {
  const { t } = useI18n();
  if (!urgency) return null;
  const tone = urgency === "high" ? "urgent" : urgency === "medium" ? "warn" : "ok";
  const icon: IconName = urgency === "low" ? "check" : "alert";
  return (
    <Chip tone={tone} icon={icon}>
      {t(`urgency.${urgency}` as MessageKey)}
    </Chip>
  );
}

const STATUS_VIEW: Record<LetterStatus, { tone: "ok" | "warn" | "urgent" | "info" | "muted" | "error"; icon: IconName }> = {
  received: { tone: "muted", icon: "clock" },
  analyzing: { tone: "info", icon: "refresh" },
  pending_review: { tone: "warn", icon: "eye" },
  approved: { tone: "info", icon: "send" },
  sent: { tone: "ok", icon: "checkCircle" },
  rejected: { tone: "muted", icon: "x" },
  failed: { tone: "error", icon: "alert" },
};

export function StatusBadge({ status }: { status: LetterStatus }) {
  const { t } = useI18n();
  const v = STATUS_VIEW[status];
  return (
    <Chip tone={v.tone} icon={v.icon}>
      {t(`status.${status}` as MessageKey)}
    </Chip>
  );
}

export function daysHint(t: ReturnType<typeof useI18n>["t"], remaining: number): string {
  return remaining < 0 ? t("deadline.passed", { days: -remaining }) : remaining === 0 ? t("deadline.today") : t("deadline.inDays", { days: remaining });
}

/** Deadline pill: written date plus a coloured "dans 13 jours" countdown. */
export function DeadlineText({ date }: { date: string }) {
  const { t, lang } = useI18n();
  const left = daysBetween(todayParis(), date);
  return (
    <span className="deadline-text">
      {formatDate(date, lang, { weekday: true })} <span className={`countdown ${left <= 7 ? "countdown-hot" : left <= 30 ? "countdown-warm" : ""}`}>{daysHint(t, left)}</span>
    </span>
  );
}

export function Countdown({ date }: { date: string }) {
  const { t } = useI18n();
  const left = daysBetween(todayParis(), date);
  const tone = left < 0 ? "urgent" : left <= 7 ? "urgent" : left <= 30 ? "warn" : "ok";
  return (
    <Chip tone={tone} icon="clock">
      {daysHint(t, left)}
    </Chip>
  );
}

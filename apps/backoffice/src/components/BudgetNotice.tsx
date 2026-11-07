// Budget warning shown on Home and on the usage screen. Kept apart from screens/Usage.tsx so the home screen does not
// pull the whole usage screen into the first download.
import type { UsageBudget } from "@wilson/contracts";
import { useQuery } from "@tanstack/react-query";
import { useI18n } from "../i18n";
import { orpc } from "../lib/api";
import { Icon } from "./Icon";

/** For the home tile and the nav: admins only, refreshed every few minutes. */
export function useUsageBudget(enabled: boolean): UsageBudget | undefined {
  const q = useQuery({ ...orpc.usage.summary.queryOptions(), enabled, refetchInterval: 300_000, retry: false });
  return q.data?.budget;
}

/** Warning shown at the top of Home and Usage when the month passes 80 % / 100 % of the budget. */
export function BudgetNotice({ budget, link }: { budget: UsageBudget | undefined; link?: string }) {
  const { t } = useI18n();
  if (!budget || (budget.state !== "warning" && budget.state !== "over")) return null;
  const over = budget.state === "over";
  const body = over ? (budget.hardStop ? t("usage.notice.stopped") : t("usage.notice.over")) : t("usage.notice.warning", { pct: Math.round(budget.usedPercent ?? 0) });
  return (
    <div className={`notice ${over ? "notice-error" : "notice-warn"}`} role="status">
      <Icon name="alert" size={20} />
      <div className="notice-body">
        <strong>{over ? t("usage.notice.overTitle") : t("usage.notice.warningTitle")}</strong>
        <p>{body}</p>
        {link && <a href={link}>{t("usage.notice.open")}</a>}
      </div>
    </div>
  );
}

import type { ApiKey } from "@wilson/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Chip } from "../components/badges";
import { Icon } from "../components/Icon";
import { ConfirmSheet, ErrorBox, OverflowMenu, Sheet, Skeleton, useToast } from "../components/ui";
import { useI18n, type MessageKey } from "../i18n";
import { orpc } from "../lib/api";
import { usd } from "./Usage";

const TONE: Record<ApiKey["status"], "ok" | "warn" | "error" | "muted"> = { active: "ok", exhausted: "warn", error: "error", disabled: "muted" };

function parseUsd(v: string): number | null | "invalid" {
  if (v.trim() === "") return null;
  const n = Number(v.replace(",", ".").trim());
  return Number.isFinite(n) && n >= 0 ? n : "invalid";
}

function KeySheet({ open, onClose, edit }: { open: boolean; onClose: () => void; edit: ApiKey | null }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [label, setLabel] = useState(edit?.label ?? "");
  const [apiKey, setApiKey] = useState("");
  const [limit, setLimit] = useState(edit?.monthlyLimitUsd == null ? "" : String(edit.monthlyLimitUsd));
  const done = (msg: string) => () => {
    toast(msg);
    void qc.invalidateQueries({ queryKey: orpc.usage.key() });
    onClose();
  };
  const add = useMutation({ ...orpc.usage.addKey.mutationOptions(), onSuccess: done(t("keys.addedToast")) });
  const update = useMutation({ ...orpc.usage.updateKey.mutationOptions(), onSuccess: done(t("keys.savedToast")) });
  const parsed = parseUsd(limit);
  const keyOk = edit !== null || /^sk-ant-[A-Za-z0-9_-]{12,}$/.test(apiKey.trim());
  const valid = label.trim() !== "" && keyOk;
  const error = add.error ?? update.error;
  return (
    <Sheet open={open} onClose={onClose} title={edit ? t("keys.edit") : t("keys.add")}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid || parsed === "invalid") return;
          if (edit) update.mutate({ id: edit.id, label: label.trim(), monthlyLimitUsd: parsed });
          else add.mutate({ label: label.trim(), apiKey: apiKey.trim(), monthlyLimitUsd: parsed });
        }}
      >
        {!edit && <p className="sheet-text">{t("keys.addHelp")}</p>}
        <label className="field">
          <span className="field-label">{t("keys.label")}</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("keys.labelPlaceholder")} maxLength={80} dir="auto" />
        </label>
        {!edit && (
          <label className="field">
            <span className="field-label">{t("keys.key")}</span>
            <input
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-ant-…"
              autoComplete="off"
              spellCheck={false}
              dir="ltr"
              type="password"
              aria-invalid={apiKey !== "" && !keyOk}
            />
            <span className="muted small">{t("keys.keyHelp")}</span>
          </label>
        )}
        <label className="field">
          <span className="field-label">{t("keys.limit")}</span>
          <input inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} placeholder={t("usage.budget.none")} dir="ltr" aria-invalid={parsed === "invalid"} />
          <span className="muted small">{t("keys.limitHelp")}</span>
        </label>
        {error && <ErrorBox error={error} />}
        <div className="stack-tight">
          <button type="submit" className="btn btn-block btn-primary" disabled={!valid || parsed === "invalid" || add.isPending || update.isPending}>
            {edit ? t("usage.budget.save") : t("keys.addButton")}
          </button>
          <button type="button" className="btn btn-block btn-quiet" onClick={onClose}>
            {t("common.cancel")}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

export function ApiKeys() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const q = useQuery({ ...orpc.usage.listKeys.queryOptions(), refetchInterval: 120_000 });
  const [sheet, setSheet] = useState<{ edit: ApiKey | null } | null>(null);
  const [removing, setRemoving] = useState<ApiKey | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: orpc.usage.key() });
  const toggle = useMutation({ ...orpc.usage.updateKey.mutationOptions(), onSuccess: () => { toast(t("keys.savedToast")); refresh(); } });
  const remove = useMutation({
    ...orpc.usage.removeKey.mutationOptions(),
    onSuccess: () => {
      toast(t("keys.removedToast"));
      setRemoving(null);
      refresh();
    },
  });

  return (
    <div className="card stack-tight">
      <div className="row between wrap">
        <h2>{t("keys.title")}</h2>
        <button type="button" className="btn btn-small btn-primary" onClick={() => setSheet({ edit: null })}>
          <Icon name="plus" size={16} />
          {t("keys.add")}
        </button>
      </div>
      <p className="muted small">{t("keys.intro")}</p>
      {q.isPending && <Skeleton lines={2} card={false} />}
      {q.isError && <ErrorBox error={q.error} retry={() => void q.refetch()} />}
      {(toggle.error ?? remove.error) && <ErrorBox error={toggle.error ?? remove.error} />}
      {q.isSuccess && (
        <ol className="key-list">
          {q.data.keys.map((k) => (
            <li key={k.id} className={`key-row${k.status === "active" ? "" : " is-off"}`}>
              <div className="row between">
                <div className="key-main">
                  <strong dir="auto">{k.label}</strong>
                  <span className="muted small" dir="ltr">
                    sk-ant-…{k.last4}
                  </span>
                </div>
                <OverflowMenu label={t("keys.actions")}>
                  {(close) => (
                    <>
                      <button type="button" role="menuitem" onClick={() => { close(); setSheet({ edit: k }); }}>
                        <Icon name="edit" size={18} />
                        {t("keys.edit")}
                      </button>
                      <button type="button" role="menuitem" onClick={() => { close(); toggle.mutate({ id: k.id, disabled: k.status !== "disabled" }); }}>
                        <Icon name={k.status === "disabled" ? "check" : "x"} size={18} />
                        {k.status === "disabled" ? t("keys.enable") : t("keys.disable")}
                      </button>
                      <button type="button" role="menuitem" onClick={() => { close(); setRemoving(k); }}>
                        <Icon name="trash" size={18} />
                        {t("keys.remove")}
                      </button>
                    </>
                  )}
                </OverflowMenu>
              </div>
              <div className="chips">
                <Chip tone={TONE[k.status]}>{t(`keys.status.${k.status}` as MessageKey)}</Chip>
              </div>
              <p className="small">
                {k.monthlyLimitUsd === null
                  ? t("keys.usedNoLimit", { used: usd(k.usedThisMonthUsd, lang) })
                  : t("usage.budget.used", { used: usd(k.usedThisMonthUsd, lang), limit: usd(k.monthlyLimitUsd, lang), pct: k.monthlyLimitUsd > 0 ? Math.round((k.usedThisMonthUsd / k.monthlyLimitUsd) * 100) : 100 })}
              </p>
              {k.monthlyLimitUsd !== null && (
                <span className={`meter${k.status === "exhausted" ? " meter-urgent" : ""}`} aria-hidden="true">
                  <span style={{ inlineSize: `${k.monthlyLimitUsd > 0 ? Math.min((k.usedThisMonthUsd / k.monthlyLimitUsd) * 100, 100) : 100}%` }} />
                </span>
              )}
              {k.status === "error" && k.lastError && <p className="muted small">{t("keys.lastError", { error: k.lastError })}</p>}
            </li>
          ))}
          <li className={`key-row${q.data.serverKey.configured ? "" : " is-off"}`}>
            <div className="key-main">
              <strong>{t("keys.server")}</strong>
              <span className="muted small">{q.data.serverKey.configured ? t("keys.serverHelp") : t("keys.serverNone")}</span>
            </div>
            {q.data.serverKey.configured && <p className="small">{t("keys.usedNoLimit", { used: usd(q.data.serverKey.usedThisMonthUsd, lang) })}</p>}
          </li>
        </ol>
      )}
      {q.isSuccess && q.data.keys.length > 0 && q.data.keys.every((k) => k.status !== "active") && !q.data.serverKey.configured && (
        <p className="notice notice-error">
          <Icon name="alert" size={20} />
          <span className="notice-body">{t("keys.noneLeft")}</span>
        </p>
      )}

      {sheet && <KeySheet open onClose={() => setSheet(null)} edit={sheet.edit} />}
      <ConfirmSheet
        open={removing !== null}
        title={t("keys.removeTitle")}
        body={t("keys.removeBody", { label: removing?.label ?? "" })}
        confirmLabel={t("keys.remove")}
        tone="danger"
        busy={remove.isPending}
        onConfirm={() => removing && remove.mutate({ id: removing.id })}
        onClose={() => setRemoving(null)}
      />
    </div>
  );
}

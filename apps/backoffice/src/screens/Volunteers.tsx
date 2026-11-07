import type { Permission, VolunteerAccount, VolunteerRole } from "@wilson/contracts";
import { PERMISSIONS, ROLE_PERMISSIONS } from "@wilson/contracts/values";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Chip } from "../components/badges";
import { Icon } from "../components/Icon";
import { ConfirmSheet, Empty, ErrorBox, OverflowMenu, Sheet, Skeleton, useToast } from "../components/ui";
import { useI18n, type MessageKey } from "../i18n";
import { orpc } from "../lib/api";
import { initials } from "../lib/relative";
import { useSession } from "../lib/session";
import { formatDate } from "../lib/wilson-i18n";
import { Segmented } from "./Queue";

type Status = VolunteerAccount["status"];
const ROLES: VolunteerRole[] = ["responder", "volunteer", "admin"];

/** Pending self-signups, for the nav badge and the home tile. */
function RolePicker({ value, onChange }: { value: VolunteerRole; onChange: (r: VolunteerRole) => void }) {
  const { t } = useI18n();
  return (
    <div className="role-picker" role="radiogroup" aria-label={t("vol.role")}>
      {ROLES.map((r) => (
        <label key={r} className={`role-option${r === value ? " is-active" : ""}`}>
          <input type="radio" name="role" value={r} checked={r === value} onChange={() => onChange(r)} />
          <span>
            <strong>{t(`vol.role.${r}` as MessageKey)}</strong>
            <span className="muted small">{t(`vol.roleDesc.${r}` as MessageKey)}</span>
          </span>
        </label>
      ))}
    </div>
  );
}

type Dialog = { kind: "approve" | "reject" | "role" | "disable" | "permissions"; account: VolunteerAccount } | null;

/** Permissions grouped by area ("letters.review" → "letters"), in PERMISSIONS order. */
const GROUPS = PERMISSIONS.reduce<{ area: string; perms: Permission[] }[]>((acc, p) => {
  const area = p.split(".")[0]!;
  const g = acc.find((x) => x.area === area);
  if (g) g.perms.push(p);
  else acc.push({ area, perms: [p] });
  return acc;
}, []);

/**
 * Tick or untick single permissions on top of the role. What differs from the role is saved as an override;
 * "Back to the role" clears them all.
 */
function PermissionsSheet({ account, onClose }: { account: VolunteerAccount; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const bundle = new Set<Permission>(ROLE_PERMISSIONS[account.role]);
  const [on, setOn] = useState<Set<Permission>>(new Set(account.permissions));
  const save = useMutation({
    ...orpc.volunteers.setPermissions.mutationOptions(),
    onSuccess: () => {
      toast(t("vol.savedToast"));
      void qc.invalidateQueries({ queryKey: orpc.volunteers.key() });
      onClose();
    },
  });
  const overrides = PERMISSIONS.filter((p) => on.has(p) !== bundle.has(p)).map((permission) => ({ permission, granted: on.has(permission) }));
  const flip = (p: Permission) => setOn((s) => {
    const n = new Set(s);
    if (n.has(p)) n.delete(p);
    else n.add(p);
    return n;
  });
  return (
    <Sheet open onClose={onClose} title={t("vol.permsTitle", { name: account.name })} wide>
      <div className="stack">
        <p className="sheet-text">{t("vol.permsHelp", { role: t(`vol.role.${account.role}` as MessageKey) })}</p>
        {GROUPS.map((g) => (
          <fieldset key={g.area} className="perm-group">
            <legend className="field-label">{t(`perm.area.${g.area}` as MessageKey)}</legend>
            {g.perms.map((p) => (
              <label key={p} className="check perm-row">
                <input type="checkbox" checked={on.has(p)} onChange={() => flip(p)} />
                <span>
                  {t(`perm.${p}` as MessageKey)}
                  {on.has(p) !== bundle.has(p) && <span className="chip chip-warn perm-changed">{on.has(p) ? t("vol.permAdded") : t("vol.permRemoved")}</span>}
                </span>
              </label>
            ))}
          </fieldset>
        ))}
        {save.error && <ErrorBox error={save.error} />}
        <div className="stack-tight">
          <button type="button" className="btn btn-block btn-primary" disabled={save.isPending} onClick={() => save.mutate({ id: account.id, overrides })}>
            {t("vol.save")}
          </button>
          <button type="button" className="btn btn-block btn-quiet" disabled={save.isPending || overrides.length === 0} onClick={() => setOn(new Set(bundle))}>
            {t("vol.permsReset")}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

export function Volunteers() {
  const { t, lang } = useI18n();
  const { volunteer: me } = useSession();
  const qc = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState<Status>("pending");
  const all = useQuery({ ...orpc.volunteers.list.queryOptions({ input: {} }), refetchInterval: 60_000 });
  const [dialog, setDialog] = useState<Dialog>(null);
  const [role, setRole] = useState<VolunteerRole>("responder");

  const done = (message: string) => () => {
    toast(message);
    setDialog(null);
    void qc.invalidateQueries({ queryKey: orpc.volunteers.key() });
  };
  const approve = useMutation({ ...orpc.volunteers.approve.mutationOptions(), onSuccess: done(t("vol.approvedToast")) });
  const reject = useMutation({ ...orpc.volunteers.reject.mutationOptions(), onSuccess: done(t("vol.rejectedToast")) });
  const setRoleM = useMutation({ ...orpc.volunteers.setRole.mutationOptions(), onSuccess: done(t("vol.savedToast")) });
  const setDisabled = useMutation({ ...orpc.volunteers.setDisabled.mutationOptions(), onSuccess: done(t("vol.savedToast")) });
  const busy = approve.isPending || reject.isPending || setRoleM.isPending || setDisabled.isPending;
  const error = approve.error ?? reject.error ?? setRoleM.error ?? setDisabled.error;

  const accounts = all.data ?? [];
  const count = (s: Status) => accounts.filter((a) => a.status === s).length;
  const items = accounts.filter((a) => a.status === filter);
  const open = (kind: NonNullable<Dialog>["kind"], account: VolunteerAccount) => {
    setRole(kind === "role" ? account.role : "responder");
    setDialog({ kind, account });
  };

  return (
    <section className="stack">
      <h1>{t("vol.title")}</h1>
      <Segmented
        label={t("vol.filter")}
        value={filter}
        onChange={setFilter}
        options={(["pending", "active", "disabled"] as Status[]).map((s) => ({ value: s, label: t(`vol.filter.${s}` as MessageKey), count: s === "pending" ? count(s) : undefined }))}
      />
      {all.isPending && <Skeleton lines={3} />}
      {all.isError && <ErrorBox error={all.error} retry={() => void all.refetch()} />}
      {error && <ErrorBox error={error} />}
      {all.isSuccess && items.length === 0 && <Empty art="people">{t(`vol.empty.${filter}` as MessageKey)}</Empty>}
      <ul className="cards">
        {items.map((a) => {
          const self = a.id === me.id;
          return (
            <li key={a.id}>
              <div className={`card vol-card${a.status === "pending" ? " is-attention" : ""}`}>
                <div className="vol-head">
                  <span className="avatar avatar-soft" aria-hidden="true">
                    {initials(a.name)}
                  </span>
                  <div className="vol-main">
                    <strong className="card-title">{a.name}</strong>
                    <span className="muted small" dir="ltr">
                      {a.email}
                    </span>
                  </div>
                  {a.status === "active" && !self && (
                    <OverflowMenu label={t("vol.changeRole")}>
                      {(close) => (
                        <>
                          <button type="button" role="menuitem" onClick={() => { close(); open("role", a); }}>
                            <Icon name="shield" size={18} />
                            {t("vol.changeRole")}
                          </button>
                          <button type="button" role="menuitem" onClick={() => { close(); open("permissions", a); }}>
                            <Icon name="check" size={18} />
                            {t("vol.perms")}
                          </button>
                          <button type="button" role="menuitem" onClick={() => { close(); open("disable", a); }}>
                            <Icon name="x" size={18} />
                            {t("vol.disable")}
                          </button>
                        </>
                      )}
                    </OverflowMenu>
                  )}
                </div>
                <div className="chips">
                  <Chip tone={a.role === "admin" ? "info" : "muted"} icon="shield">
                    {t(`vol.role.${a.role}` as MessageKey)}
                  </Chip>
                  {a.status === "disabled" && <Chip tone="error">{t("vol.status.disabled")}</Chip>}
                  {self && <Chip tone="ok">{t("vol.you")}</Chip>}
                  {a.overrides.length > 0 && <Chip tone="warn">{t("vol.customPerms", { n: a.overrides.length })}</Chip>}
                </div>
                {a.note && (
                  <p className="vol-note" dir="auto">
                    {a.note}
                  </p>
                )}
                <p className="muted small">
                  {t("vol.requestedOn", { date: formatDate(a.createdAt.slice(0, 10), lang) })}
                  {a.approvedByName && (
                    <>
                      {" · "}
                      {t("vol.approvedBy", { name: a.approvedByName })}
                    </>
                  )}
                </p>
                {a.status === "pending" && (
                  <div className="row wrap">
                    <button type="button" className="btn btn-primary btn-small" disabled={busy} onClick={() => open("approve", a)}>
                      <Icon name="check" size={16} />
                      {t("vol.approve")}
                    </button>
                    <button type="button" className="btn btn-small btn-danger-quiet" disabled={busy} onClick={() => open("reject", a)}>
                      <Icon name="x" size={16} />
                      {t("vol.reject")}
                    </button>
                  </div>
                )}
                {a.status === "disabled" && (
                  <div className="row wrap">
                    <button type="button" className="btn btn-small" disabled={busy} onClick={() => setDisabled.mutate({ id: a.id, disabled: false })}>
                      <Icon name="undo" size={16} />
                      {t("vol.enable")}
                    </button>
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {dialog && (dialog.kind === "approve" || dialog.kind === "role") && (
        <Sheet open onClose={() => setDialog(null)} title={dialog.kind === "approve" ? t("vol.approveTitle", { name: dialog.account.name }) : t("vol.changeRole")}>
          <div className="stack">
            <p className="sheet-text">{t("vol.approveBody")}</p>
            <RolePicker value={role} onChange={setRole} />
            <div className="stack-tight">
              <button
                type="button"
                className="btn btn-block btn-primary"
                disabled={busy}
                onClick={() => (dialog.kind === "approve" ? approve.mutate({ id: dialog.account.id, role }) : setRoleM.mutate({ id: dialog.account.id, role }))}
              >
                {dialog.kind === "approve" ? t("vol.approve") : t("vol.save")}
              </button>
              <button type="button" className="btn btn-block btn-quiet" onClick={() => setDialog(null)}>
                {t("common.cancel")}
              </button>
            </div>
          </div>
        </Sheet>
      )}
      {dialog?.kind === "permissions" && <PermissionsSheet account={dialog.account} onClose={() => setDialog(null)} />}
      <ConfirmSheet
        open={dialog?.kind === "reject"}
        title={t("vol.rejectTitle")}
        body={dialog ? t("vol.rejectBody", { name: dialog.account.name }) : undefined}
        confirmLabel={t("vol.reject")}
        tone="danger"
        busy={busy}
        onConfirm={() => dialog && reject.mutate({ id: dialog.account.id })}
        onClose={() => setDialog(null)}
      />
      <ConfirmSheet
        open={dialog?.kind === "disable"}
        title={t("vol.disable")}
        body={t("vol.disableBody")}
        confirmLabel={t("vol.disable")}
        tone="danger"
        busy={busy}
        onConfirm={() => dialog && setDisabled.mutate({ id: dialog.account.id, disabled: true })}
        onClose={() => setDialog(null)}
      />
    </section>
  );
}

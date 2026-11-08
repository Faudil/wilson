import type { Invitation, Permission, VolunteerAccount, VolunteerRole } from "@wilson/contracts";
import { ASSOCIATION_ADMIN_PERMISSIONS, GLOBAL_ONLY_PERMISSIONS, PERMISSIONS, ROLE_PERMISSIONS } from "@wilson/contracts/values";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Chip } from "../components/badges";
import { Icon } from "../components/Icon";
import { ConfirmSheet, Empty, ErrorBox, OverflowMenu, Sheet, Skeleton, useToast } from "../components/ui";
import { useI18n, type MessageKey } from "../i18n";
import { orpc } from "../lib/api";
import { initials } from "../lib/relative";
import { useSession, type Session } from "../lib/session";
import { formatDate, formatDateTime } from "../lib/wilson-i18n";
import { Segmented } from "./Queue";

type Status = VolunteerAccount["status"];
type Tab = Status | "invites";
const ROLES: VolunteerRole[] = ["responder", "volunteer", "admin"];

/** null = every account (global admin); else the association whose members this person manages. */
const scopeOf = (s: Session) => (s.can("volunteers.manage") ? null : s.volunteer.association);
/** Association admins hand out at most the volunteer role (checked again on the server). */
const rolesFor = (s: Session): VolunteerRole[] => (scopeOf(s) ? ["responder", "volunteer"] : ROLES);

function RolePicker({ value, onChange, roles = ROLES }: { value: VolunteerRole; onChange: (r: VolunteerRole) => void; roles?: VolunteerRole[] }) {
  const { t } = useI18n();
  return (
    <div className="role-picker" role="radiogroup" aria-label={t("vol.role")}>
      {roles.map((r) => (
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

type Dialog = { kind: "approve" | "reject" | "role" | "disable" | "permissions" | "member" | "reset2fa" | "resetPassword"; account: VolunteerAccount } | null;

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
  const session = useSession();
  const scoped = scopeOf(session) !== null;
  const bundle = new Set<Permission>([...ROLE_PERMISSIONS[account.role], ...(account.associationAdmin ? ASSOCIATION_ADMIN_PERMISSIONS : [])]);
  // Association admins cannot touch global-only rights, nor give a right they do not have themselves.
  const locked = (p: Permission) => scoped && (GLOBAL_ONLY_PERMISSIONS.includes(p) || (!session.can(p) && !account.permissions.includes(p)));
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
        {scoped && <p className="muted small">{t("vol.permsScoped")}</p>}
        {GROUPS.map((g) => (
          <fieldset key={g.area} className="perm-group">
            <legend className="field-label">{t(`perm.area.${g.area}` as MessageKey)}</legend>
            {g.perms.map((p) => (
              <label key={p} className="check perm-row">
                <input type="checkbox" checked={on.has(p)} disabled={locked(p)} onChange={() => flip(p)} />
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
          <button type="button" className="btn btn-block btn-quiet" disabled={save.isPending || overrides.length === 0} onClick={() => setOn(new Set([...[...bundle].filter((p) => !locked(p)), ...[...on].filter(locked)]))}>
            {t("vol.permsReset")}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

/** Link to the join page for a raw invite token (the token is only ever shown here, once). */
const joinLink = (token: string) => `${window.location.origin}${window.location.pathname}#/join/${token}`;

const resetLink = (token: string) => `${window.location.origin}${window.location.pathname}#/reset/${token}`;

/** Someone forgot their password: create a one-time link (24 h) and hand it over by hand. No e-mail service needed. */
function ResetPasswordSheet({ account, onClose }: { account: VolunteerAccount; onClose: () => void }) {
  const { t, lang } = useI18n();
  const [copied, setCopied] = useState(false);
  const create = useMutation(orpc.volunteers.passwordResetLink.mutationOptions());
  const link = create.data ? resetLink(create.data.token) : null;
  return (
    <Sheet open onClose={onClose} title={t("vol.resetPassword")}>
      <div className="stack">
        {!link ? (
          <>
            <p className="sheet-text">{t("vol.resetPasswordBody", { name: account.name })}</p>
            {create.error && (
              <div className="notice notice-error" role="alert">
                <Icon name="alert" />
                <span className="notice-body">{t("error.generic")}</span>
              </div>
            )}
            <div className="stack-tight">
              <button type="button" className="btn btn-block btn-primary" disabled={create.isPending} onClick={() => create.mutate({ id: account.id })}>
                <Icon name="link" size={18} />
                {t("vol.resetPasswordCreate")}
              </button>
              <button type="button" className="btn btn-block btn-quiet" onClick={onClose}>
                {t("common.cancel")}
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="sheet-text">{t("vol.resetPasswordReady", { name: account.name, until: formatDateTime(create.data!.expiresAt, lang) })}</p>
            <label className="field">
              <span className="field-label">{t("vol.resetPasswordLink")}</span>
              <input readOnly value={link} dir="ltr" onFocus={(e) => e.currentTarget.select()} />
            </label>
            <div className="stack-tight">
              <button
                type="button"
                className="btn btn-block btn-primary"
                onClick={() => {
                  void navigator.clipboard?.writeText(link).then(() => setCopied(true), () => setCopied(false));
                }}
              >
                <Icon name={copied ? "check" : "link"} size={18} />
                {copied ? t("inv.copied") : t("inv.copy")}
              </button>
              <button type="button" className="btn btn-block btn-quiet" onClick={onClose}>
                {t("common.close")}
              </button>
            </div>
          </>
        )}
      </div>
    </Sheet>
  );
}

/** Create a single-use invite link and hand it over by hand (WhatsApp, SMS, e-mail). */
function InviteSheet({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const session = useSession();
  const scope = scopeOf(session);
  const [role, setRole] = useState<VolunteerRole>("responder");
  const [label, setLabel] = useState("");
  const [associationId, setAssociationId] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const associations = useQuery({ ...orpc.associations.list.queryOptions(), enabled: scope === null && session.can("associations.manage") });
  const create = useMutation({
    ...orpc.invitations.create.mutationOptions(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: orpc.invitations.key() }),
  });
  const link = create.data ? joinLink(create.data.token) : null;
  const where = scope?.name ?? associations.data?.find((a) => a.id === associationId)?.name ?? null;

  if (link) {
    const share = typeof navigator.share === "function";
    return (
      <Sheet open onClose={onClose} title={t("inv.readyTitle")}>
        <div className="stack">
          <p className="sheet-text">{t("inv.readyBody")}</p>
          <label className="field">
            <span className="field-label">{t("inv.link")}</span>
            <input readOnly value={link} dir="ltr" onFocus={(e) => e.currentTarget.select()} />
          </label>
          <div className="stack-tight">
            <button
              type="button"
              className="btn btn-block btn-primary"
              onClick={() => {
                void navigator.clipboard?.writeText(link).then(() => setCopied(true), () => setCopied(false));
              }}
            >
              <Icon name={copied ? "check" : "link"} size={18} />
              {copied ? t("inv.copied") : t("inv.copy")}
            </button>
            {share && (
              <button type="button" className="btn btn-block" onClick={() => void navigator.share({ title: t("inv.shareTitle"), text: t("inv.shareText", { name: where ?? t("app.name") }), url: link }).catch(() => {})}>
                <Icon name="send" size={18} />
                {t("inv.share")}
              </button>
            )}
            <button type="button" className="btn btn-block btn-quiet" onClick={onClose}>
              {t("common.close")}
            </button>
          </div>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open onClose={onClose} title={t("inv.title")}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate({ role, label: label.trim() || undefined, associationId: scope === null ? associationId || null : undefined });
        }}
      >
        <p className="sheet-text">{where ? t("inv.intro", { name: where }) : t("inv.introGlobal")}</p>
        <label className="field">
          <span className="field-label">
            {t("inv.label")} <span className="muted small">({t("common.optional")})</span>
          </span>
          <input maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("inv.labelPlaceholder")} />
        </label>
        {scope === null && associations.data && associations.data.length > 0 && (
          <label className="field">
            <span className="field-label">{t("inv.association")}</span>
            <select value={associationId} onChange={(e) => setAssociationId(e.target.value)}>
              <option value="">{t("inv.noAssociation")}</option>
              {associations.data.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <RolePicker value={role} onChange={setRole} roles={rolesFor(session)} />
        {create.error && <ErrorBox error={create.error} />}
        <div className="stack-tight">
          <button type="submit" className="btn btn-block btn-primary" disabled={create.isPending}>
            <Icon name="link" size={18} />
            {t("inv.create")}
          </button>
          <button type="button" className="btn btn-block btn-quiet" onClick={onClose}>
            {t("common.cancel")}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

const INVITE_TONE: Record<Invitation["status"], "ok" | "muted" | "error" | "info"> = { open: "info", used: "ok", expired: "muted", revoked: "error" };

/** The last invite links: who made them, for whom, and whether they were used. Open ones can be revoked. */
function InvitationList() {
  const { t, lang } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery(orpc.invitations.list.queryOptions());
  const revoke = useMutation({
    ...orpc.invitations.revoke.mutationOptions(),
    onSuccess: () => {
      toast(t("inv.revokedToast"));
      void qc.invalidateQueries({ queryKey: orpc.invitations.key() });
    },
  });
  if (list.isPending) return <Skeleton lines={2} />;
  if (list.isError) return <ErrorBox error={list.error} retry={() => void list.refetch()} />;
  if (list.data.length === 0) return <Empty art="people" sub={t("inv.emptySub")}>{t("inv.empty")}</Empty>;
  return (
    <>
      {revoke.error && <ErrorBox error={revoke.error} />}
      <ul className="cards">
        {list.data.map((i) => (
          <li key={i.id}>
            <div className="card stack-tight">
              <div className="row between wrap">
                <strong className="card-title" dir="auto">
                  {i.label ?? t("inv.noLabel")}
                </strong>
                <Chip tone={INVITE_TONE[i.status]}>{t(`inv.status.${i.status}` as MessageKey)}</Chip>
              </div>
              <div className="chips">
                <Chip tone="muted" icon="shield">
                  {t(`vol.role.${i.role}` as MessageKey)}
                </Chip>
                {i.association && (
                  <Chip tone="muted" icon="building">
                    {i.association.name}
                  </Chip>
                )}
              </div>
              <p className="muted small">
                {[
                  i.createdByName && t("inv.by", { name: i.createdByName }),
                  i.status === "used" && i.usedByName ? t("inv.usedBy", { name: i.usedByName }) : null,
                  i.status === "open" ? t("inv.until", { date: formatDate(i.expiresAt.slice(0, 10), lang) }) : null,
                ].filter(Boolean).join(" · ")}
              </p>
              {i.status === "open" && (
                <div className="row wrap">
                  <button type="button" className="btn btn-small btn-danger-quiet" disabled={revoke.isPending} onClick={() => revoke.mutate({ id: i.id })}>
                    <Icon name="x" size={16} />
                    {t("inv.revoke")}
                  </button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

/** Global admins: put someone in an association, or take them out (an association admin loses that role). */
function MemberSheet({ account, onClose }: { account: VolunteerAccount; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [associationId, setAssociationId] = useState(account.memberOf?.id ?? "");
  const associations = useQuery(orpc.associations.list.queryOptions());
  const save = useMutation({
    ...orpc.associations.setMember.mutationOptions(),
    onSuccess: () => {
      toast(t("vol.savedToast"));
      void qc.invalidateQueries({ queryKey: orpc.volunteers.key() });
      void qc.invalidateQueries({ queryKey: orpc.associations.key() });
      onClose();
    },
  });
  return (
    <Sheet open onClose={onClose} title={t("vol.memberTitle", { name: account.name })}>
      <div className="stack">
        {account.association && (
          <p className="sheet-text">
            {t("vol.memberClaimed")} <strong dir="auto">{account.association.name}</strong>
          </p>
        )}
        {associations.isError && <ErrorBox error={associations.error} />}
        <label className="field">
          <span className="field-label">{t("inv.association")}</span>
          <select value={associationId} onChange={(e) => setAssociationId(e.target.value)}>
            <option value="">{t("inv.noAssociation")}</option>
            {(associations.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </label>
        {account.associationAdmin && associationId !== (account.memberOf?.id ?? "") && <p className="muted small">{t("vol.memberLosesAdmin")}</p>}
        {save.error && <ErrorBox error={save.error} />}
        <div className="stack-tight">
          <button type="button" className="btn btn-block btn-primary" disabled={save.isPending} onClick={() => save.mutate({ volunteerId: account.id, associationId: associationId || null })}>
            {t("vol.save")}
          </button>
          <button type="button" className="btn btn-block btn-quiet" onClick={onClose}>
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

export function Volunteers() {
  const { t, lang } = useI18n();
  const session = useSession();
  const { volunteer: me } = session;
  const scope = scopeOf(session);
  const canAssociations = scope === null && session.can("associations.manage");
  const qc = useQueryClient();
  const toast = useToast();
  const [filter, setFilter] = useState<Tab>("pending");
  const [inviting, setInviting] = useState(false);
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
  const reset2fa = useMutation({ ...orpc.volunteers.resetTwoFactor.mutationOptions(), onSuccess: done(t("vol.savedToast")) });
  const busy = approve.isPending || reject.isPending || setRoleM.isPending || setDisabled.isPending || reset2fa.isPending;
  const error = approve.error ?? reject.error ?? setRoleM.error ?? setDisabled.error ?? reset2fa.error;
  const unverified = (error as { data?: { reason?: string } } | null)?.data?.reason === "email_unverified";

  const accounts = all.data ?? [];
  const count = (s: Status) => accounts.filter((a) => a.status === s).length;
  const items = accounts.filter((a) => a.status === filter);
  const open = (kind: NonNullable<Dialog>["kind"], account: VolunteerAccount) => {
    setRole(kind === "role" ? account.role : "responder");
    setDialog({ kind, account });
  };

  return (
    <section className="stack">
      <div className="row between wrap">
        <h1>{t("vol.title")}</h1>
        <button type="button" className="btn btn-primary btn-small" onClick={() => setInviting(true)}>
          <Icon name="link" size={16} />
          {t("inv.button")}
        </button>
      </div>
      {scope && (
        <p className="notice" role="note">
          <Icon name="building" />
          <span className="notice-body">{t("vol.scopedIntro", { name: scope.name })}</span>
        </p>
      )}
<div className="vol-tabs">
        <Segmented
          label={t("vol.filter")}
          value={filter}
          onChange={setFilter}
          options={(["pending", "active", "disabled", "invites"] as Tab[]).map((s) => ({
            value: s,
            label: t(`vol.filter.${s}` as MessageKey),
            count: s === "pending" ? count("pending") : undefined,
          }))}
        />
      </div>
      {filter === "invites" && <InvitationList />}
      {all.isPending && filter !== "invites" && <Skeleton lines={3} />}
      {all.isError && <ErrorBox error={all.error} retry={() => void all.refetch()} />}
      {error && !unverified && <ErrorBox error={error} />}
      {unverified && (
        <p className="notice notice-warn" role="alert">
          <Icon name="alert" />
          <span className="notice-body">{t("vol.emailUnverifiedHint")}</span>
        </p>
      )}
      {all.isSuccess && filter !== "invites" && items.length === 0 && <Empty art="people">{t(`vol.empty.${filter}` as MessageKey)}</Empty>}
      <ul className="cards">
        {items.map((a) => {
          const self = a.id === me.id;
          // Association admins manage plain members only; fellow admins are handled by a global admin.
          const manageable = scope === null || !(a.associationAdmin || a.role === "admin");
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
                  {a.status === "active" && !self && manageable && (
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
                          {canAssociations && (
                            <button type="button" role="menuitem" onClick={() => { close(); open("member", a); }}>
                              <Icon name="building" size={18} />
                              {t("vol.memberMenu")}
                            </button>
                          )}
                          <button type="button" role="menuitem" onClick={() => { close(); open("resetPassword", a); }}>
                            <Icon name="link" size={18} />
                            {t("vol.resetPassword")}
                          </button>
                          {a.twoFactorEnabled && (
                            <button type="button" role="menuitem" onClick={() => { close(); open("reset2fa", a); }}>
                              <Icon name="refresh" size={18} />
                              {t("vol.reset2fa")}
                            </button>
                          )}
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
                  {a.status === "pending" && !a.emailVerified && <Chip tone="warn">{t("vol.emailUnverified")}</Chip>}
                  {a.twoFactorEnabled && (
                    <Chip tone="ok" icon="shield">
                      {t("vol.twoFactor")}
                    </Chip>
                  )}
                  {self && <Chip tone="ok">{t("vol.you")}</Chip>}
                  {a.associationAdmin && <Chip tone="info" icon="shield">{t("vol.associationAdmin")}</Chip>}
                  {scope === null && a.memberOf && <Chip tone="muted" icon="building">{a.memberOf.name}</Chip>}
                  {a.overrides.length > 0 && <Chip tone="warn">{t("vol.customPerms", { n: a.overrides.length })}</Chip>}
                </div>
                {a.association && (
                  <p className="vol-assoc">
                    <Icon name="building" size={16} />
                    <span className="vol-assoc-text">
                      <span>
                        <strong dir="auto">{a.association.name}</strong>
                        {a.association.city && <span className="muted"> · {a.association.city}</span>}
                      </span>
                      {a.association.rna || a.association.siren ? (
                        <Chip tone="ok" icon="checkCircle">
                          {a.association.rna ?? a.association.siren}
                        </Chip>
                      ) : (
                        <Chip tone="muted">{t("vol.associationFreeText")}</Chip>
                      )}
                    </span>
                  </p>
                )}
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
                    {canAssociations && (
                      <button type="button" className="btn btn-small btn-quiet" disabled={busy} onClick={() => open("member", a)}>
                        <Icon name="building" size={16} />
                        {a.memberOf ? t("vol.memberMenu") : t("vol.memberLink")}
                      </button>
                    )}
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
            <RolePicker value={role} onChange={setRole} roles={rolesFor(session)} />
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
      {dialog?.kind === "member" && <MemberSheet account={dialog.account} onClose={() => setDialog(null)} />}
      {inviting && <InviteSheet onClose={() => setInviting(false)} />}
      {dialog?.kind === "resetPassword" && <ResetPasswordSheet account={dialog.account} onClose={() => setDialog(null)} />}
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
        open={dialog?.kind === "reset2fa"}
        title={t("vol.reset2fa")}
        body={t("vol.reset2faBody")}
        confirmLabel={t("vol.reset2fa")}
        tone="danger"
        busy={busy}
        onConfirm={() => dialog && reset2fa.mutate({ id: dialog.account.id })}
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

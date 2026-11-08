import type { Association, AssociationRef } from "@wilson/contracts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AssociationField } from "../components/AssociationField";
import { Chip } from "../components/badges";
import { Icon } from "../components/Icon";
import { ConfirmSheet, Empty, ErrorBox, Sheet, Skeleton, useToast } from "../components/ui";
import { useI18n } from "../i18n";
import { errorCode, orpc } from "../lib/api";

/** Create an association, from the official register or by name. */
function CreateSheet({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [value, setValue] = useState<AssociationRef | null>(null);
  const create = useMutation({
    ...orpc.associations.create.mutationOptions(),
    onSuccess: () => {
      toast(t("assoc.createdToast"));
      void qc.invalidateQueries({ queryKey: orpc.associations.key() });
      void qc.invalidateQueries({ queryKey: orpc.volunteers.key() });
      onClose();
    },
  });
  return (
    <Sheet open onClose={onClose} title={t("assoc.create")}>
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          if (value) create.mutate(value);
        }}
      >
        <p className="sheet-text">{t("assoc.createHelp")}</p>
        <AssociationField value={value} onChange={setValue} label={t("assoc.name")} optional={false} />
        {create.isError && (
          <p className="notice notice-error" role="alert">
            <Icon name="alert" />
            <span className="notice-body">{errorCode(create.error) === "CONFLICT" ? t("assoc.exists") : t("error.generic")}</span>
          </p>
        )}
        <div className="stack-tight">
          <button type="submit" className="btn btn-block btn-primary" disabled={!value || create.isPending}>
            {t("assoc.create")}
          </button>
          <button type="button" className="btn btn-block btn-quiet" onClick={onClose}>
            {t("common.cancel")}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

/** Pick an active volunteer and make them admin of this association (they join it if they were elsewhere). */
function AdminSheet({ association, onClose }: { association: Association; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const people = useQuery(orpc.volunteers.list.queryOptions({ input: { status: "active" } }));
  const name = useMutation({
    ...orpc.associations.setAdmin.mutationOptions(),
    onSuccess: () => {
      toast(t("assoc.adminAddedToast"));
      void qc.invalidateQueries({ queryKey: orpc.associations.key() });
      void qc.invalidateQueries({ queryKey: orpc.volunteers.key() });
      onClose();
    },
  });
  const needle = q.trim().toLowerCase();
  const candidates = (people.data ?? [])
    .filter((a) => !(a.associationAdmin && a.memberOf?.id === association.id))
    .filter((a) => !needle || a.name.toLowerCase().includes(needle) || a.email.toLowerCase().includes(needle))
    // Members of this association first: they are the usual pick.
    .sort((a, z) => Number(z.memberOf?.id === association.id) - Number(a.memberOf?.id === association.id) || a.name.localeCompare(z.name, "fr"));
  return (
    <Sheet open onClose={onClose} title={t("assoc.addAdminTitle", { name: association.name })} wide>
      <div className="stack">
        <p className="sheet-text">{t("assoc.addAdminHelp")}</p>
        <label className="field">
          <span className="field-label">{t("assoc.searchPerson")}</span>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
        </label>
        {people.isPending && <Skeleton lines={2} />}
        {people.isError && <ErrorBox error={people.error} retry={() => void people.refetch()} />}
        <div className="role-picker" role="radiogroup" aria-label={t("assoc.searchPerson")}>
          {candidates.slice(0, 30).map((a) => (
            <label key={a.id} className={`role-option${picked === a.id ? " is-active" : ""}`}>
              <input type="radio" name="admin" value={a.id} checked={picked === a.id} onChange={() => setPicked(a.id)} />
              <span>
                <strong>{a.name}</strong>
                <span className="muted small" dir="ltr">
                  {a.email}
                </span>
                {a.memberOf && a.memberOf.id !== association.id && (
                  <span className="muted small">{t("assoc.movesFrom", { name: a.memberOf.name })}</span>
                )}
              </span>
            </label>
          ))}
        </div>
        {people.isSuccess && candidates.length === 0 && <p className="muted">{t("assoc.nobody")}</p>}
        {name.error && <ErrorBox error={name.error} />}
        <div className="stack-tight">
          <button
            type="button"
            className="btn btn-block btn-primary"
            disabled={!picked || name.isPending}
            onClick={() => picked && name.mutate({ volunteerId: picked, associationId: association.id, admin: true })}
          >
            {t("assoc.addAdmin")}
          </button>
          <button type="button" className="btn btn-block btn-quiet" onClick={onClose}>
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

type Dialog = { kind: "create" } | { kind: "admin"; association: Association } | { kind: "remove"; association: Association; admin: { id: string; name: string } } | null;

/** Global admins: the associations using Wilson, and who administers each one. */
export function Associations() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const toast = useToast();
  const list = useQuery(orpc.associations.list.queryOptions());
  const [dialog, setDialog] = useState<Dialog>(null);
  const remove = useMutation({
    ...orpc.associations.setAdmin.mutationOptions(),
    onSuccess: () => {
      toast(t("assoc.adminRemovedToast"));
      setDialog(null);
      void qc.invalidateQueries({ queryKey: orpc.associations.key() });
      void qc.invalidateQueries({ queryKey: orpc.volunteers.key() });
    },
  });

  return (
    <section className="stack">
      <div className="row between wrap">
        <h1>{t("assoc.title")}</h1>
        <button type="button" className="btn btn-primary btn-small" onClick={() => setDialog({ kind: "create" })}>
          <Icon name="plus" size={16} />
          {t("assoc.create")}
        </button>
      </div>
      <p className="muted">{t("assoc.intro")}</p>
      {list.isPending && <Skeleton lines={3} />}
      {list.isError && <ErrorBox error={list.error} retry={() => void list.refetch()} />}
      {remove.error && <ErrorBox error={remove.error} />}
      {list.isSuccess && list.data.length === 0 && <Empty art="people">{t("assoc.empty")}</Empty>}
      <ul className="cards">
        {(list.data ?? []).map((a) => (
          <li key={a.id}>
            <div className="card stack-tight">
              <div className="vol-head">
                <span className="avatar avatar-soft" aria-hidden="true">
                  <Icon name="building" size={18} />
                </span>
                <div className="vol-main">
                  <strong className="card-title" dir="auto">
                    {a.name}
                  </strong>
                  <span className="muted small">
                    {[a.city, t("assoc.members", { n: a.memberCount })].filter(Boolean).join(" · ")}
                  </span>
                </div>
              </div>
              <div className="chips">
                {a.rna || a.siren ? (
                  <Chip tone="ok" icon="checkCircle">
                    {a.rna ?? a.siren}
                  </Chip>
                ) : (
                  <Chip tone="muted">{t("vol.associationFreeText")}</Chip>
                )}
                {a.pendingCount > 0 && <Chip tone="warn">{t("assoc.pending", { n: a.pendingCount })}</Chip>}
              </div>
              <div className="stack-tight">
                <span className="field-label">{t("assoc.admins")}</span>
                {a.admins.length === 0 ? (
                  <p className="muted small">{t("assoc.noAdmin")}</p>
                ) : (
                  <ul className="assoc-admins">
                    {a.admins.map((ad) => (
                      <li key={ad.id}>
                        <Icon name="shield" size={16} />
                        <span>{ad.name}</span>
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label={t("assoc.removeAdmin", { name: ad.name })}
                          onClick={() => setDialog({ kind: "remove", association: a, admin: ad })}
                        >
                          <Icon name="x" size={16} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="row wrap">
                <button type="button" className="btn btn-small" onClick={() => setDialog({ kind: "admin", association: a })}>
                  <Icon name="plus" size={16} />
                  {t("assoc.addAdmin")}
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      {dialog?.kind === "create" && <CreateSheet onClose={() => setDialog(null)} />}
      {dialog?.kind === "admin" && <AdminSheet association={dialog.association} onClose={() => setDialog(null)} />}
      <ConfirmSheet
        open={dialog?.kind === "remove"}
        title={dialog?.kind === "remove" ? t("assoc.removeAdmin", { name: dialog.admin.name }) : ""}
        body={dialog?.kind === "remove" ? t("assoc.removeAdminBody", { name: dialog.admin.name, association: dialog.association.name }) : undefined}
        confirmLabel={t("assoc.removeAdminConfirm")}
        tone="danger"
        busy={remove.isPending}
        onConfirm={() => dialog?.kind === "remove" && remove.mutate({ volunteerId: dialog.admin.id, associationId: dialog.association.id, admin: false })}
        onClose={() => setDialog(null)}
      />
    </section>
  );
}

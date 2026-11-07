import { useMutation, useQuery } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import type { AssociationRef } from "@wilson/contracts";
import { AssociationField } from "../components/AssociationField";
import { Icon } from "../components/Icon";
import { Empty, ErrorBox, Skeleton } from "../components/ui";
import { useI18n } from "../i18n";
import { errorCode, orpc } from "../lib/api";
import { href } from "../lib/router";

/**
 * Public "become a volunteer" form. The account is created pending; an admin approves it in Bénévoles.
 * With a valid invite link (#/join/<token>) the account is active at once, in the inviting association.
 */
export function Signup({ invitationToken }: { invitationToken?: string } = {}) {
  const { t, lang } = useI18n();
  const health = useQuery({ ...orpc.system.health.queryOptions(), retry: false, staleTime: 60_000 });
  const preview = useQuery({
    ...orpc.auth.invitation.queryOptions({ input: { token: invitationToken ?? "" } }),
    enabled: !!invitationToken && invitationToken.length >= 20 && invitationToken.length <= 100,
    retry: false,
    staleTime: Infinity,
  });
  const invited = preview.data?.valid === true;
  const badInvite = !!invitationToken && (preview.isError || preview.data?.valid === false || invitationToken.length < 20 || invitationToken.length > 100);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [note, setNote] = useState("");
  const [association, setAssociation] = useState<AssociationRef | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [show, setShow] = useState(false);
  const [website, setWebsite] = useState(""); // honeypot, see below
  const signup = useMutation(orpc.auth.signup.mutationOptions());

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!accepted) return;
    signup.mutate({
      name: name.trim(), email: email.trim(), password, uiLanguage: lang, note: note.trim() || undefined,
      association: invited ? undefined : (association ?? undefined), invitationToken: invited ? invitationToken : undefined, acceptsConfidentiality: true, website: website || undefined,
    });
  };
  const code = errorCode(signup.error);
  const closed = !invited && (health.data?.signup === false || code === "FORBIDDEN");

  if (signup.isSuccess) {
    return (
      <div className="login">
        <div className="card">
          <Empty art="done" sub={invited ? t("join.doneText") : t(health.data?.emailVerification ? "signup.doneTextEmail" : "signup.doneText")}>
            {invited ? t("join.doneTitle") : t("signup.doneTitle")}
          </Empty>
        </div>
        <p className="center">
          <a className={`btn btn-block${invited ? " btn-primary" : ""}`} href={href("")}>
            {invited ? t("join.login") : t("signup.backToLogin")}
          </a>
        </p>
      </div>
    );
  }

  return (
    <div className="login">
      <div className="login-hero" aria-hidden="true">
        <span className="login-mark">
          <Icon name="hand" size={34} />
        </span>
      </div>
      <h1>{invited ? t("join.title") : t("signup.title")}</h1>
      {invitationToken && preview.isPending && !badInvite ? null : invited ? (
        <p className="notice notice-ok" role="status">
          <Icon name="checkCircle" />
          <span className="notice-body">
            {preview.data?.associationName ? t("join.intro", { name: preview.data.associationName }) : t("join.introNoAssociation")}
          </span>
        </p>
      ) : (
        <>
          {badInvite && (
            <p className="notice notice-warn" role="status">
              <Icon name="info" />
              <span className="notice-body">{t("join.invalid")}</span>
            </p>
          )}
          <p className="muted">{t("signup.intro")}</p>
        </>
      )}
      {closed ? (
        <p className="notice notice-warn" role="status">
          <Icon name="info" />
          <span className="notice-body">{t("signup.closed")}</span>
        </p>
      ) : (
        <form onSubmit={submit} className="card stack">
          {/* Honeypot: invisible to people and screen readers, bots fill it in and their request is ignored. */}
          <input className="visually-hidden" tabIndex={-1} aria-hidden="true" autoComplete="off" name="website" value={website} onChange={(e) => setWebsite(e.target.value)} />
          <label className="field">
            <span className="field-label">{t("signup.name")}</span>
            <input autoComplete="name" required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span className="field-label">{t("login.email")}</span>
            <input type="email" autoComplete="email" required maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" />
          </label>
          <label className="field">
            <span className="field-label">{t("signup.password")}</span>
            <span className="input-wrap">
              <input
                type={show ? "text" : "password"}
                autoComplete="new-password"
                required
                minLength={10}
                maxLength={200}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                dir="ltr"
              />
              <button type="button" className="icon-btn input-action" onClick={() => setShow(!show)} aria-label={show ? t("login.hidePassword") : t("login.showPassword")}>
                <Icon name={show ? "eyeOff" : "eye"} />
              </button>
            </span>
          </label>
          {!invited && <AssociationField value={association} onChange={setAssociation} />}
          <label className="field">
            <span className="field-label">
              {t("signup.note")} <span className="muted small">({t("common.optional")})</span>
            </span>
            <textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          <label className="check signup-check">
            <input type="checkbox" required checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
            <span>{t("signup.confidentiality")}</span>
          </label>
          {signup.isError && (
            <p className="notice notice-error" role="alert">
              <Icon name="alert" />
              <span className="notice-body">{code === "CONFLICT" ? t("signup.full") : code === "TOO_MANY_REQUESTS" ? t("signup.tooMany") : t("error.generic")}</span>
            </p>
          )}
          <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={signup.isPending || !accepted}>
            {signup.isPending ? t("common.loading") : invited ? t("join.submit") : t("signup.submit")}
          </button>
        </form>
      )}
      <p className="center">
        <a className="link-quiet" href={href("")}>
          {t("signup.backToLogin")}
        </a>
      </p>
    </div>
  );
}

/** The link in the verification e-mail: #/verify/<token>. */
export function VerifyEmail({ token }: { token: string }) {
  const { t } = useI18n();
  const verify = useMutation(orpc.auth.verifyEmail.mutationOptions());
  const { mutate } = verify;
  useEffect(() => mutate({ token }), [mutate, token]);
  return (
    <div className="login">
      <div className="card">
        {verify.isError ? (
          <ErrorBox error={verify.error} retry={() => mutate({ token })} />
        ) : verify.isSuccess ? (
          <Empty art="done" sub={t("verify.text")}>
            {t("verify.title")}
          </Empty>
        ) : (
          <Skeleton lines={2} card={false} />
        )}
      </div>
      <p className="center">
        <a className="btn btn-block" href={href("")}>
          {t("signup.backToLogin")}
        </a>
      </p>
    </div>
  );
}

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Icon } from "../components/Icon";
import { Empty } from "../components/ui";
import { useI18n } from "../i18n";
import { errorCode, orpc } from "../lib/api";
import { href } from "../lib/router";

/** Public "become a volunteer" form. The account is created pending; an admin approves it in Bénévoles. */
export function Signup() {
  const { t, lang } = useI18n();
  const health = useQuery({ ...orpc.system.health.queryOptions(), retry: false, staleTime: 60_000 });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [note, setNote] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [show, setShow] = useState(false);
  const signup = useMutation(orpc.auth.signup.mutationOptions());

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!accepted) return;
    signup.mutate({ name: name.trim(), email: email.trim(), password, uiLanguage: lang, note: note.trim() || undefined, acceptsConfidentiality: true });
  };
  const code = errorCode(signup.error);
  const closed = health.data?.signup === false || code === "FORBIDDEN";

  if (signup.isSuccess) {
    return (
      <div className="login">
        <div className="card">
          <Empty art="done" sub={t("signup.doneText")}>
            {t("signup.doneTitle")}
          </Empty>
        </div>
        <p className="center">
          <a className="btn btn-block" href={href("")}>
            {t("signup.backToLogin")}
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
      <h1>{t("signup.title")}</h1>
      <p className="muted">{t("signup.intro")}</p>
      {closed ? (
        <p className="notice notice-warn" role="status">
          <Icon name="info" />
          <span className="notice-body">{t("signup.closed")}</span>
        </p>
      ) : (
        <form onSubmit={submit} className="card stack">
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
              <span className="notice-body">{code === "CONFLICT" ? t("signup.full") : t("error.generic")}</span>
            </p>
          )}
          <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={signup.isPending || !accepted}>
            {signup.isPending ? t("common.loading") : t("signup.submit")}
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

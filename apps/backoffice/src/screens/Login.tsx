import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Icon } from "../components/Icon";
import { orpc, errorCode } from "../lib/api";
import { useI18n } from "../i18n";
import { ME_KEY } from "../lib/me";
import { href } from "../lib/router";
import logoUrl from "../brand/logo.svg";

export function Login() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  /** Shown once the password was right for an account with an authenticator app. */
  const [needCode, setNeedCode] = useState(false);
  const [totp, setTotp] = useState("");
  const health = useQuery({ ...orpc.system.health.queryOptions(), retry: false, staleTime: 60_000 });
  const login = useMutation({
    ...orpc.auth.login.mutationOptions(),
    onSuccess: (volunteer) => qc.setQueryData(ME_KEY, volunteer),
    onError: (e) => {
      if (errorCode(e) === "TWO_FACTOR_REQUIRED") setNeedCode(true);
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate({ email: email.trim(), password, totp: needCode && totp ? totp.replace(/\D/g, "") : undefined });
  };
  const code = errorCode(login.error);
  const wait = code === "TOO_MANY_REQUESTS" ? Math.ceil(((login.error as { data?: { retryAfterSeconds?: number } }).data?.retryAfterSeconds ?? 60) / 60) : 0;
  const message =
    code === "UNAUTHORIZED" ? t("login.wrong")
    : code === "FORBIDDEN" ? t("login.pending")
    : code === "TOO_MANY_REQUESTS" ? t("login.locked", { n: wait })
    : code === "TWO_FACTOR_REQUIRED" ? ((login.error as Error).message === "invalid_code" ? t("login.codeWrong") : null)
    : t("error.generic");

  return (
    <div className="login">
      <div className="login-hero">
        <img className="login-logo" src={logoUrl} alt="Solidarité Migrants Wilson" width={168} height={168} />
      </div>
      <h1>{t("login.welcome")}</h1>
      <p className="muted">{t("login.intro")}</p>
      <form onSubmit={submit} className="card stack">
        <label className="field">
          <span className="field-label">{t("login.email")}</span>
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" />
        </label>
        <label className="field">
          <span className="field-label">{t("login.password")}</span>
          <span className="input-wrap">
            <input
              type={show ? "text" : "password"}
              autoComplete="current-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              dir="ltr"
            />
            <button type="button" className="icon-btn input-action" onClick={() => setShow(!show)} aria-label={show ? t("login.hidePassword") : t("login.showPassword")}>
              <Icon name={show ? "eyeOff" : "eye"} />
            </button>
          </span>
        </label>
        {needCode && (
          <label className="field">
            <span className="field-label">{t("login.code")}</span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9 ]{6,7}"
              maxLength={7}
              required
              autoFocus
              value={totp}
              onChange={(e) => setTotp(e.target.value)}
              dir="ltr"
            />
            <span className="muted small">{t("login.codeHint")}</span>
          </label>
        )}
        {login.isError && message && (
          <p className="notice notice-error" role="alert">
            <Icon name="alert" />
            <span className="notice-body">{message}</span>
          </p>
        )}
        <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={login.isPending}>
          {login.isPending ? t("common.loading") : t("login.submit")}
        </button>
      </form>
      {health.data?.signup && (
        <p className="center login-signup">
          <span className="muted">{t("login.noAccount")}</span>{" "}
          <a href={href("signup")}>{t("login.signupLink")}</a>
        </p>
      )}
      <p className="center">
        <a className="link-quiet" href="#/languages">
          <Icon name="globe" size={16} /> {t("nav.languages")}
        </a>
      </p>
    </div>
  );
}

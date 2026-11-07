import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Icon } from "../components/Icon";
import { orpc, errorCode } from "../lib/api";
import { useI18n } from "../i18n";
import { ME_KEY } from "../lib/me";
import { href } from "../lib/router";

export function Login() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const health = useQuery({ ...orpc.system.health.queryOptions(), retry: false, staleTime: 60_000 });
  const login = useMutation({
    ...orpc.auth.login.mutationOptions(),
    onSuccess: (volunteer) => qc.setQueryData(ME_KEY, volunteer),
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    login.mutate({ email: email.trim(), password });
  };
  const code = errorCode(login.error);

  return (
    <div className="login">
      <div className="login-hero" aria-hidden="true">
        <span className="login-mark">
          <Icon name="mail" size={34} />
        </span>
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
        {login.isError && (
          <p className="notice notice-error" role="alert">
            <Icon name="alert" />
            <span className="notice-body">{code === "UNAUTHORIZED" ? t("login.wrong") : code === "FORBIDDEN" ? t("login.pending") : t("error.generic")}</span>
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

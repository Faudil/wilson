import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { orpc, errorCode } from "../lib/api";
import { useI18n } from "../i18n";
import { ME_KEY } from "../lib/me";

export function Login() {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
    <main className="narrow">
      <h1>{t("login.title")}</h1>
      <p className="muted">{t("login.intro")}</p>
      <form onSubmit={submit} className="stack">
        <label className="field">
          <span>{t("login.email")}</span>
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} dir="ltr" />
        </label>
        <label className="field">
          <span>{t("login.password")}</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            dir="ltr"
          />
        </label>
        {login.isError && (
          <p className="notice notice-error" role="alert">
            {code === "UNAUTHORIZED" ? t("login.wrong") : t("error.generic")}
          </p>
        )}
        <button type="submit" className="btn btn-primary btn-block" disabled={login.isPending}>
          {login.isPending ? t("common.loading") : t("login.submit")}
        </button>
      </form>
      <p>
        <a href="#/languages">{t("nav.languages")}</a>
      </p>
    </main>
  );
}

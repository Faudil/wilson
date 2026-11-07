import { useMutation, useQueryClient } from "@tanstack/react-query";
import qrcode from "qrcode-generator";
import { useMemo, useState, type FormEvent } from "react";
import { Icon } from "../components/Icon";
import { useI18n } from "../i18n";
import { errorCode, orpc } from "../lib/api";
import { ME_KEY } from "../lib/me";
import { useSession } from "../lib/session";

/** QR code of the otpauth:// link, as an inline SVG path (no image request, sharp on every screen). */
function Qr({ text }: { text: string }) {
  const { size, path } = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    const n = qr.getModuleCount();
    let d = "";
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 2} ${r + 2}h1v1h-1z`;
    return { size: n + 4, path: d };
  }, [text]);
  return (
    <svg className="qr" viewBox={`0 0 ${size} ${size}`} width={200} height={200} role="img" aria-label="QR code" shapeRendering="crispEdges">
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

/** Two-factor authentication in the account sheet: enrol an authenticator app, or turn it off. */
export function TwoFactorPanel() {
  const { t } = useI18n();
  const { volunteer } = useSession();
  const qc = useQueryClient();
  const [code, setCode] = useState("");
  const setup = useMutation(orpc.auth.twoFactorSetup.mutationOptions());
  const onDone = {
    onSuccess: (v: typeof volunteer) => {
      qc.setQueryData(ME_KEY, v);
      setCode("");
      setup.reset();
    },
  };
  const enable = useMutation({ ...orpc.auth.twoFactorEnable.mutationOptions(), ...onDone });
  const disable = useMutation({ ...orpc.auth.twoFactorDisable.mutationOptions(), ...onDone });
  const failed = errorCode(enable.error ?? disable.error) === "CONFLICT";
  const clean = code.replace(/\D/g, "");

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (volunteer.twoFactorEnabled) disable.mutate({ code: clean });
    else enable.mutate({ code: clean });
  };
  const codeField = (
    <form onSubmit={submit} className="stack-tight">
      <label className="field">
        <span className="field-label">{t("login.code")}</span>
        <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required value={code} onChange={(e) => setCode(e.target.value)} dir="ltr" />
      </label>
      {failed && (
        <p className="notice notice-error" role="alert">
          <Icon name="alert" />
          <span className="notice-body">{t("login.codeWrong")}</span>
        </p>
      )}
      <button type="submit" className={`btn btn-block${volunteer.twoFactorEnabled ? " btn-danger-quiet" : " btn-primary"}`} disabled={enable.isPending || disable.isPending}>
        {volunteer.twoFactorEnabled ? t("tfa.disable") : t("tfa.confirm")}
      </button>
    </form>
  );

  return (
    <div className="stack-tight">
      <span className="field-label">
        <Icon name="shield" size={16} /> {t("tfa.title")}
      </span>
      {volunteer.twoFactorEnabled ? (
        <>
          <p className="muted small">{t("tfa.on")}</p>
          {codeField}
        </>
      ) : setup.data ? (
        <>
          <ol className="small tfa-steps">
            <li>{t("tfa.step1")}</li>
            <li>{t("tfa.step2")}</li>
          </ol>
          <div className="center">
            <Qr text={setup.data.uri} />
          </div>
          <a className="btn btn-block btn-small" href={setup.data.uri}>
            {t("tfa.openApp")}
          </a>
          <p className="muted small">
            {t("tfa.manual")}{" "}
            <code dir="ltr" className="tfa-secret">
              {setup.data.secret.replace(/(.{4})/g, "$1 ").trim()}
            </code>
          </p>
          {codeField}
        </>
      ) : (
        <>
          <p className="muted small">{volunteer.twoFactorMissing ? t("tfa.required") : t("tfa.off")}</p>
          <button type="button" className="btn btn-block" disabled={setup.isPending} onClick={() => setup.mutate(undefined)}>
            {t("tfa.start")}
          </button>
        </>
      )}
    </div>
  );
}

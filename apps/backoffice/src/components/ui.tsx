import { useEffect, useState, type ReactNode } from "react";
import { errorCode } from "../lib/api";
import { useI18n } from "../i18n";

export function Loading() {
  const { t } = useI18n();
  return (
    <p className="muted" role="status">
      {t("common.loading")}
    </p>
  );
}

export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  const { t } = useI18n();
  const code = errorCode(error);
  const message =
    code === "FORBIDDEN" ? t("error.forbidden") : code === "NOT_FOUND" ? t("error.notFound") : t("error.generic");
  return (
    <div className="notice notice-error" role="alert">
      <p>{message}</p>
      {retry && (
        <button type="button" className="btn" onClick={retry}>
          {t("common.retry")}
        </button>
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <a className="back-link" href={to}>
      <span className="dir-icon" aria-hidden="true">
        ←
      </span>{" "}
      {children}
    </a>
  );
}

/** Object URL for a Blob/File, revoked on change/unmount. */
export function useObjectUrl(blob: Blob | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!blob) {
      setUrl(null);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}

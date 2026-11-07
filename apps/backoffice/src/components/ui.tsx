import { createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { errorCode } from "../lib/api";
import { useI18n } from "../i18n";
import { Icon, type IconName } from "./Icon";

export function Skeleton({ lines = 3, card = true }: { lines?: number; card?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="skeleton-list" role="status" aria-busy="true">
      <span className="visually-hidden">{t("common.loading")}</span>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className={card ? "skeleton-card" : "skeleton-line"} aria-hidden="true">
          {card && (
            <>
              <span className="skeleton skeleton-pill" />
              <span className="skeleton skeleton-title" />
              <span className="skeleton skeleton-text" />
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/** Kept for places that only need a quick spinner-less placeholder. */
export function Loading() {
  return <Skeleton lines={2} />;
}

export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  const { t } = useI18n();
  const code = errorCode(error);
  const message =
    code === "FORBIDDEN" ? t("error.forbidden") : code === "NOT_FOUND" ? t("error.notFound") : t("error.generic");
  return (
    <div className="notice notice-error" role="alert">
      <Icon name="alert" />
      <div className="notice-body">
        <p>{message}</p>
        {retry && (
          <button type="button" className="btn btn-small" onClick={retry}>
            <Icon name="refresh" size={16} />
            {t("common.retry")}
          </button>
        )}
      </div>
    </div>
  );
}

export type Illustration = "letters" | "chat" | "people" | "calendar" | "done" | "search" | "book";

/** Soft inline illustrations: a few rounded shapes in the theme colours. */
function Art({ kind }: { kind: Illustration }) {
  const common = { width: 120, height: 96, viewBox: "0 0 120 96", fill: "none", "aria-hidden": true } as const;
  const base = <ellipse cx="60" cy="86" rx="38" ry="5" className="art-shadow" />;
  switch (kind) {
    case "letters":
      return (
        <svg {...common}>
          {base}
          <rect x="22" y="26" width="76" height="52" rx="10" className="art-fill" />
          <path d="M26 34l34 24 34-24" className="art-line" />
          <circle cx="92" cy="26" r="11" className="art-accent" />
          <path d="m87 26 3.500 3.500L97 22" className="art-check" />
        </svg>
      );
    case "chat":
      return (
        <svg {...common}>
          {base}
          <rect x="18" y="16" width="62" height="40" rx="14" className="art-fill" />
          <rect x="44" y="44" width="58" height="34" rx="14" className="art-accent-soft" />
          <circle cx="36" cy="36" r="3" className="art-dot" />
          <circle cx="49" cy="36" r="3" className="art-dot" />
          <circle cx="62" cy="36" r="3" className="art-dot" />
        </svg>
      );
    case "people":
      return (
        <svg {...common}>
          {base}
          <circle cx="46" cy="36" r="13" className="art-fill" />
          <path d="M22 78c0-14 10-22 24-22s24 8 24 22" className="art-fill" />
          <circle cx="82" cy="42" r="10" className="art-accent-soft" />
          <path d="M66 78c1-11 8-17 16-17s15 6 16 17" className="art-accent-soft" />
        </svg>
      );
    case "calendar":
      return (
        <svg {...common}>
          {base}
          <rect x="24" y="22" width="72" height="56" rx="12" className="art-fill" />
          <path d="M24 40h72" className="art-line" />
          <rect x="40" y="14" width="6" height="14" rx="3" className="art-accent" />
          <rect x="74" y="14" width="6" height="14" rx="3" className="art-accent" />
          <circle cx="44" cy="58" r="4" className="art-dot" />
          <circle cx="60" cy="58" r="4" className="art-dot" />
          <circle cx="76" cy="58" r="4" className="art-accent" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          {base}
          <circle cx="54" cy="42" r="22" className="art-fill" />
          <circle cx="54" cy="42" r="22" className="art-line" />
          <path d="m71 59 18 18" className="art-line art-thick" />
        </svg>
      );
    case "book":
      return (
        <svg {...common}>
          {base}
          <path d="M60 28c-8-6-22-8-34-6v50c12-2 26 0 34 6V28Z" className="art-fill" />
          <path d="M60 28c8-6 22-8 34-6v50c-12-2-26 0-34 6V28Z" className="art-accent-soft" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          {base}
          <circle cx="60" cy="46" r="32" className="art-ok-soft" />
          <circle cx="60" cy="46" r="22" className="art-ok" />
          <path d="m49 46 8 8 14-16" className="art-check" />
        </svg>
      );
  }
}

export function Empty({ children, art = "done", sub, action }: { children: ReactNode; art?: Illustration; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <Art kind={art} />
      <p className="empty-title">{children}</p>
      {sub && <p className="empty-sub">{sub}</p>}
      {action}
    </div>
  );
}

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <a className="back-link" href={to}>
      <Icon name="arrow" size={18} />
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

/* ---------- Bottom sheet ---------- */

const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';

export function Sheet({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const node = ref.current;
    node?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab" && node) {
        const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)];
        if (items.length === 0) return;
        const first = items[0]!;
        const last = items[items.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!open) return null;
  return (
    <div className="sheet-root">
      <div className="sheet-backdrop" onClick={onClose} />
      <div ref={ref} className={`sheet${wide ? " sheet-wide" : ""}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <div className="sheet-grip" aria-hidden="true" />
        <div className="sheet-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t("common.close")}>
            <Icon name="x" />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmSheet({
  open,
  title,
  body,
  confirmLabel,
  tone = "primary",
  busy,
  onConfirm,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  tone?: "primary" | "danger";
  busy?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="stack">
        {body && <p className="sheet-text">{body}</p>}
        {children}
        <div className="stack-tight">
          <button type="button" className={`btn btn-block ${tone === "danger" ? "btn-danger" : "btn-primary"}`} disabled={busy} onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button type="button" className="btn btn-block btn-quiet" onClick={onClose}>
            {t("common.cancel")}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

/* ---------- Toasts ---------- */

type Toast = { id: number; message: string; tone: "ok" | "error" | "info" };
const ToastContext = createContext<(message: string, tone?: Toast["tone"]) => void>(() => undefined);
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);
  const push = useCallback((message: string, tone: Toast["tone"] = "ok") => {
    const id = ++counter.current;
    setToasts((list) => [...list.slice(-2), { id, message, tone }]);
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), 5000);
  }, []);
  const value = useMemo(() => push, [push]);
  const icon: Record<Toast["tone"], IconName> = { ok: "checkCircle", error: "alert", info: "info" };
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite" aria-atomic="false">
        {toasts.map((x) => (
          <div key={x.id} className={`toast toast-${x.tone}`} role="status">
            <Icon name={icon[x.tone]} />
            <span>{x.message}</span>
            <button type="button" className="icon-btn icon-btn-small" aria-label={t("common.close")} onClick={() => setToasts((l) => l.filter((y) => y.id !== x.id))}>
              <Icon name="x" size={16} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Small "…" overflow menu. */
export function OverflowMenu({ label, children }: { label: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button type="button" className="icon-btn" aria-label={label} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="more" />
      </button>
      {open && (
        <div className="menu-list" role="menu">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}

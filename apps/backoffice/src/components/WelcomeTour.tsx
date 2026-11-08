import { useEffect, useState } from "react";
import { useI18n, type MessageKey } from "../i18n";
import { useSession } from "../lib/session";
import { Icon, type IconName } from "./Icon";
import { Sheet } from "./ui";

const KEY = "wilson.tour.seen";
/** Opens the tour again from the account sheet, wherever the volunteer is. */
export const TOUR_EVENT = "wilson:tour";

const STEPS: { icon: IconName; title: MessageKey; body: MessageKey }[] = [
  { icon: "chat", title: "tour.1.title", body: "tour.1.body" },
  { icon: "eye", title: "tour.2.title", body: "tour.2.body" },
  { icon: "shield", title: "tour.3.title", body: "tour.3.body" },
];

function seen(id: string): boolean {
  try {
    return (localStorage.getItem(KEY) ?? "").split(",").includes(id);
  } catch {
    return true; // No storage (private window): don't show the tour on every visit.
  }
}
function markSeen(id: string) {
  try {
    const ids = new Set((localStorage.getItem(KEY) ?? "").split(",").filter(Boolean));
    ids.add(id);
    localStorage.setItem(KEY, [...ids].join(","));
  } catch {
    /* ignore */
  }
}

/** Three short cards the first time a volunteer opens Wilson on this device: what it is, how to review, what it never does. */
export function WelcomeTour() {
  const { t } = useI18n();
  const { volunteer } = useSession();
  const [open, setOpen] = useState(() => !seen(volunteer.id));
  const [step, setStep] = useState(0);
  useEffect(() => {
    const again = () => {
      setStep(0);
      setOpen(true);
    };
    window.addEventListener(TOUR_EVENT, again);
    return () => window.removeEventListener(TOUR_EVENT, again);
  }, []);
  const close = () => {
    markSeen(volunteer.id);
    setOpen(false);
  };
  const s = STEPS[step]!;
  const last = step === STEPS.length - 1;
  return (
    <Sheet open={open} onClose={close} title={t("tour.title")}>
      <div className="tour">
        <span className="tour-icon" aria-hidden="true">
          <Icon name={s.icon} size={32} />
        </span>
        <h3 className="tour-title">{t(s.title)}</h3>
        <p className="tour-body">{t(s.body)}</p>
        <div className="tour-dots" aria-label={t("tour.progress", { n: step + 1, total: STEPS.length })} role="img">
          {STEPS.map((_, i) => (
            <span key={i} className={i === step ? "is-on" : ""} />
          ))}
        </div>
        <div className="row tour-actions">
          {!last && (
            <button type="button" className="btn btn-quiet" onClick={close}>
              {t("tour.skip")}
            </button>
          )}
          <button type="button" className="btn btn-primary btn-grow" onClick={() => (last ? close() : setStep(step + 1))}>
            {last ? t("tour.start") : t("tour.next")}
            {!last && <Icon name="arrowRight" size={18} />}
          </button>
        </div>
      </div>
    </Sheet>
  );
}

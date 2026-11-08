import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useI18n, type MessageKey } from "../i18n";
import { orpc } from "../lib/api";
import { ME_KEY } from "../lib/me";
import { href } from "../lib/router";
import type { Session } from "../lib/session";
import { Icon, type IconName } from "./Icon";
import { Sheet } from "./ui";

/** What the volunteer can do, from their permissions (first card). */
const CAN: { permission: Parameters<Session["can"]>[0]; key: MessageKey; icon: IconName }[] = [
  { permission: "conversations.reply", key: "welcome.can.conversations", icon: "chat" },
  { permission: "letters.review", key: "welcome.can.letters", icon: "mail" },
  { permission: "notes.write", key: "welcome.can.notes", icon: "file" },
  { permission: "places.manage", key: "welcome.can.places", icon: "pin" },
  { permission: "appointments.accept", key: "welcome.can.appointments", icon: "calendar" },
];

/**
 * First login after approval: three short cards (what you can do, the "no legal advice" rule with an example,
 * practise in the sandbox). Closing it in any way marks it seen, so it never comes back.
 */
export function WelcomeSheet({ session }: { session: Session }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const health = useQuery({ ...orpc.system.health.queryOptions(), staleTime: 60_000 });
  const finish = useMutation({
    ...orpc.auth.finishWelcome.mutationOptions(),
    onSuccess: (v) => qc.setQueryData(ME_KEY, v),
  });
  const close = () => {
    if (!finish.isPending) finish.mutate(undefined);
  };
  const sandbox = health.data?.mode === "sandbox" && session.can("sandbox.use");
  const can = CAN.filter((c) => session.can(c.permission));
  const last = 2;

  return (
    <Sheet open onClose={close} title={t(`welcome.title.${step}` as MessageKey, { name: session.volunteer.name })}>
      <div className="stack welcome">
        <p className="welcome-steps small muted" aria-live="polite">
          {t("welcome.step", { n: step + 1, total: last + 1 })}
        </p>
        {step === 0 && (
          <>
            <p className="sheet-text">{t("welcome.intro")}</p>
            <ul className="welcome-list">
              {can.map((c) => (
                <li key={c.key}>
                  <Icon name={c.icon} size={18} />
                  <span>{t(c.key)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {step === 1 && (
          <>
            <p className="sheet-text">{t("welcome.legal")}</p>
            <div className="callout">
              <Icon name="info" size={20} />
              <div className="stack-tight">
                <span>
                  <strong>{t("welcome.legalAskLabel")}</strong> {t("welcome.legalAsk")}
                </span>
                <span>
                  <strong>{t("welcome.legalAnswerLabel")}</strong> {t("welcome.legalAnswer")}
                </span>
              </div>
            </div>
            <p className="sheet-text">{t("welcome.legalHandoff")}</p>
          </>
        )}
        {step === 2 && (
          <>
            <p className="sheet-text">{t(sandbox ? "welcome.practice" : "welcome.practiceNoSandbox")}</p>
            {sandbox && (
              <a className="btn btn-block" href={href("sandbox")} onClick={close}>
                <Icon name="flask" size={18} />
                {t("welcome.openSandbox")}
              </a>
            )}
          </>
        )}
        <div className="stack-tight">
          {step < last ? (
            <button type="button" className="btn btn-block btn-primary" onClick={() => setStep(step + 1)}>
              {t("welcome.next")}
              <Icon name="arrowRight" size={18} />
            </button>
          ) : (
            <button type="button" className="btn btn-block btn-primary" disabled={finish.isPending} onClick={close}>
              <Icon name="check" size={18} />
              {t("welcome.done")}
            </button>
          )}
          {step < last && (
            <button type="button" className="btn btn-block btn-quiet" onClick={close}>
              {t("welcome.skip")}
            </button>
          )}
        </div>
      </div>
    </Sheet>
  );
}

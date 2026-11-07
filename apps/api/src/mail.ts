/** Outgoing e-mail (volunteer address verification only). Disabled unless SMTP_URL is set. */
import nodemailer from "nodemailer";
import type { Config } from "./config.js";

export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void>;
}

const mailers = new WeakMap<object, Mailer | null>();

export function getMailer(deps: { config: Pick<Config, "SMTP_URL" | "MAIL_FROM"> }): Mailer | null {
  if (mailers.has(deps.config)) return mailers.get(deps.config)!;
  const { SMTP_URL, MAIL_FROM } = deps.config;
  const mailer: Mailer | null = SMTP_URL
    ? (() => {
        const transport = nodemailer.createTransport(SMTP_URL);
        return { send: async (to, subject, text) => void (await transport.sendMail({ from: MAIL_FROM, to, subject, text })) };
      })()
    : null;
  mailers.set(deps.config, mailer);
  return mailer;
}

/** Tests: replace the mailer of a running app. */
export function setMailer(deps: { config: object }, mailer: Mailer | null): void {
  mailers.set(deps.config, mailer);
}

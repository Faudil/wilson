import { randomUUID } from "node:crypto";
import type { LanguageCode } from "@wilson/contracts";
import { messages } from "../db/schema.js";
import type { Interactive } from "./interactive.js";
import type { SandboxTransportDeps } from "./sandbox.js";
import type { WhatsAppTransport } from "./transport.js";

/**
 * People with a web account ("Mon espace", src/webAccounts/) have no phone number: their address is "web:<id>".
 * The conversation engine and the send queue do not change; this transport delivers to those addresses by writing the
 * message to `messages` (their web page reads it from there) and passes every other address to the real transport.
 * Files they upload are blobs `web/<id>/<uuid>`, read back by `downloadMedia` like WhatsApp media.
 */
export const WEB_ADDRESS_PREFIX = "web:";
const WEB_MEDIA = /^web\/([0-9a-f-]{36})\/[0-9a-f-]{36}$/;
/** Message ids of web deliveries: storeOutbound (send.ts) skips them, the row already exists. */
export const WEB_MESSAGE_PREFIX = "web.out.";

export const webAddress = (beneficiaryId: string): string => `${WEB_ADDRESS_PREFIX}${beneficiaryId}`;
export const isWebAddress = (to: string): boolean => to.startsWith(WEB_ADDRESS_PREFIX);

/** Stores an upload from the web page, encrypted like any media; returns the media id to hand to the engine. */
export async function putWebMedia(deps: SandboxTransportDeps, beneficiaryId: string, bytes: Buffer, mimeType: string): Promise<string> {
  const dek = await deps.beneficiaries.getDek(beneficiaryId);
  const key = `web/${beneficiaryId}/${randomUUID()}`;
  await deps.blobs.put(key, deps.crypto.encrypt(dek, Buffer.concat([Buffer.from(`${mimeType}\n`), bytes])));
  return key;
}

export function withWebAccounts(inner: WhatsAppTransport, deps: SandboxTransportDeps): WhatsAppTransport {
  async function record(to: string, kind: "text" | "template" | "interactive", body: string): Promise<{ waMessageId: string }> {
    const beneficiaryId = to.slice(WEB_ADDRESS_PREFIX.length);
    const dek = await deps.beneficiaries.getDek(beneficiaryId);
    const waMessageId = `${WEB_MESSAGE_PREFIX}${randomUUID()}`;
    await deps.db.insert(messages).values({
      beneficiaryId, direction: "out", kind, waMessageId, bodyEnc: deps.crypto.encrypt(dek, body), status: "sent",
    });
    return { waMessageId };
  }

  return {
    get mode() {
      return inner.mode;
    },
    sendText: (to: string, body: string) => (isWebAddress(to) ? record(to, "text", body) : inner.sendText(to, body)),
    /** Recorded as the plain menu text, kind "interactive": the web page draws the buttons from it (like the sandbox). */
    sendInteractive: (to: string, m: Interactive, fallbackText: string) => {
      if (isWebAddress(to)) return record(to, "interactive", fallbackText);
      return inner.sendInteractive ? inner.sendInteractive(to, m, fallbackText) : inner.sendText(to, fallbackText);
    },
    // Never reached for web accounts (their "window" is always open, see windowOpen), kept for safety.
    sendTemplate: (to: string, template: string, language: LanguageCode, params: string[]) =>
      isWebAddress(to) ? record(to, "template", params.join("\n")) : inner.sendTemplate(to, template, language, params),
    downloadMedia: async (mediaId: string) => {
      const m = WEB_MEDIA.exec(mediaId);
      if (!m) return inner.downloadMedia(mediaId);
      const dek = await deps.beneficiaries.getDek(m[1]!);
      const plain = deps.crypto.decrypt(dek, await deps.blobs.get(mediaId));
      const nl = plain.indexOf(0x0a);
      return { mimeType: plain.subarray(0, nl).toString("utf8"), bytes: plain.subarray(nl + 1) };
    },
    ...(inner.markRead ? { markRead: (id: string) => inner.markRead!(id) } : {}),
  };
}

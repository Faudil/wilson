import { randomUUID } from "node:crypto";
import { messages } from "../db/schema.js";
import type { Interactive } from "./interactive.js";
import type { SandboxTransportDeps } from "./sandbox.js";
import type { ChannelTransport } from "../channels/types.js";

/**
 * People with a web account ("Mon espace", src/webAccounts/) have no phone number: their address is "web:<id>".
 * They are on the "web" channel (`beneficiaries.channel`), so the conversation engine and the send queue treat them
 * like any other channel. Files they upload are blobs `web/<id>/<uuid>`.
 */
export const WEB_ADDRESS_PREFIX = "web:";
const WEB_MEDIA = /^web\/([0-9a-f-]{36})\/[0-9a-f-]{36}$/;
/** Message ids of web deliveries (unique across channels, see channels/types.ts); the row is written by WebTransport. */
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

/**
 * The "web" channel: delivering to a web account means writing the message to `messages` (their page reads it from
 * there). No 24 h window, no templates. Files they upload are read back by `downloadMedia` like WhatsApp media.
 */
export class WebTransport implements ChannelTransport {
  readonly channel = "web" as const;
  readonly mode = "web" as const;
  readonly capabilities = { serviceWindow: false };
  constructor(private readonly deps: SandboxTransportDeps) {}

  private async record(to: string, kind: "text" | "template" | "interactive", body: string): Promise<{ waMessageId: string }> {
    if (!isWebAddress(to)) throw new Error("web: not a web account address");
    const beneficiaryId = to.slice(WEB_ADDRESS_PREFIX.length);
    const dek = await this.deps.beneficiaries.getDek(beneficiaryId);
    const waMessageId = `${WEB_MESSAGE_PREFIX}${randomUUID()}`;
    await this.deps.db.insert(messages).values({
      beneficiaryId, direction: "out", kind, waMessageId, bodyEnc: this.deps.crypto.encrypt(dek, body), status: "sent",
    });
    return { waMessageId };
  }

  sendText(to: string, body: string) {
    return this.record(to, "text", body);
  }

  /** Recorded as the plain menu text, kind "interactive": the web page draws the buttons from it (like the sandbox). */
  sendInteractive(to: string, _m: Interactive, fallbackText: string) {
    return this.record(to, "interactive", fallbackText);
  }

  async downloadMedia(mediaId: string) {
    const m = WEB_MEDIA.exec(mediaId);
    if (!m) throw new Error("web: unknown media id");
    const dek = await this.deps.beneficiaries.getDek(m[1]!);
    const plain = this.deps.crypto.decrypt(dek, await this.deps.blobs.get(mediaId));
    const nl = plain.indexOf(0x0a);
    return { mimeType: plain.subarray(0, nl).toString("utf8"), bytes: plain.subarray(nl + 1) };
  }
}

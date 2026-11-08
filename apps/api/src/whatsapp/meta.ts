import { isBsuid, isRtl, type LanguageCode } from "@wilson/contracts";
import { isolate } from "@wilson/i18n";
import type { Config } from "../config.js";
import { META_TEMPLATE_LANGUAGE, templateLanguageFor } from "./templates.js";
import type { WhatsAppTransport } from "./transport.js";
import type { Interactive } from "./interactive.js";

/** WhatsApp text messages are capped at 4096 characters. */
const MAX_TEXT = 4096;

/** Split a long message on paragraph, then line, then word boundaries so each part fits in one WhatsApp message. */
export function splitText(body: string, max = MAX_TEXT): string[] {
  if (body.length <= max) return [body];
  const parts: string[] = [];
  let rest = body;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = window.lastIndexOf("\n\n");
    if (cut < max / 2) cut = window.lastIndexOf("\n");
    if (cut < max / 2) cut = window.lastIndexOf(" ");
    if (cut <= 0) cut = max;
    parts.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}

/** Meta rejects template parameters that are empty or contain newlines, tabs or more than 4 consecutive spaces. */
export function templateParam(text: string, rtl: boolean): string {
  const clean = text.replace(/[\n\r\t]+/g, " ").replace(/ {2,}/g, " ").trim() || "-";
  return rtl ? isolate(clean) : clean;
}

/** Graph error codes we act on. */
export const META_ERRORS = {
  /** More than 24 h since the person's last message: only a template may be sent. */
  reEngagement: 131047,
  /** Template not available in this language. */
  templateLanguage: 132001,
  /** This message type cannot be sent to a business-scoped user id (BSUID). */
  bsuidUnsupported: 131062,
} as const;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class MetaApiError extends Error {
  constructor(message: string, readonly status: number, readonly metaCode?: number) {
    super(message);
    this.name = "MetaApiError";
  }
}

/** WhatsApp Cloud API (Graph) transport. Never logs the access token or message bodies. */
export class MetaTransport implements WhatsAppTransport {
  readonly mode = "meta" as const;
  private readonly base: string;

  constructor(
    private readonly config: Pick<Config, "WHATSAPP_PHONE_NUMBER_ID" | "WHATSAPP_ACCESS_TOKEN" | "WHATSAPP_GRAPH_VERSION">,
    private readonly fetchImpl: FetchLike = (u, i) => fetch(u, i),
  ) {
    this.base = `https://graph.facebook.com/${config.WHATSAPP_GRAPH_VERSION}`;
  }

  private headers(json = true): Record<string, string> {
    return { Authorization: `Bearer ${this.config.WHATSAPP_ACCESS_TOKEN}`, ...(json ? { "Content-Type": "application/json" } : {}) };
  }

  private async fail(res: Response, what: string): Promise<never> {
    let code: number | undefined;
    let msg = "";
    try {
      const j = (await res.json()) as { error?: { code?: number; message?: string } };
      code = j.error?.code;
      msg = j.error?.message ?? "";
    } catch {
      /* not json */
    }
    throw new MetaApiError(`${what} failed: HTTP ${res.status}${code ? ` code ${code}` : ""} ${msg}`.trim(), res.status, code);
  }

  /**
   * `to` is a phone number, or a BSUID when WhatsApp hides the number: those go in `recipient` (Cloud API, since
   * July 2026). Error 131062 means this message type cannot go to a BSUID.
   */
  private async postMessage(payload: Record<string, unknown> & { to: string }): Promise<{ waMessageId: string }> {
    const { to, ...rest } = payload;
    const address = isBsuid(to) ? { recipient: to } : { to };
    const res = await this.fetchImpl(`${this.base}/${this.config.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...address, ...rest }),
    });
    if (!res.ok) return this.fail(res, "send message");
    const j = (await res.json()) as { messages?: { id: string }[] };
    const id = j.messages?.[0]?.id;
    if (!id) throw new MetaApiError("send message: no message id in response", res.status);
    return { waMessageId: id };
  }

  /** Long texts are sent as several messages, in order; the id of the last one is returned. */
  async sendText(to: string, body: string): Promise<{ waMessageId: string }> {
    let last: { waMessageId: string } | null = null;
    for (const part of splitText(body)) last = await this.postMessage({ to, type: "text", text: { body: part, preview_url: false } });
    return last!;
  }

  async sendInteractive(to: string, m: Interactive): Promise<{ waMessageId: string }> {
    const interactive =
      m.kind === "buttons"
        ? { type: "button", body: { text: m.body }, action: { buttons: m.choices.map((c) => ({ type: "reply", reply: { id: c.id, title: c.title } })) } }
        : { type: "list", body: { text: m.body }, action: { button: m.listButton, sections: [{ rows: m.choices.map((c) => ({ id: c.id, title: c.title, ...(c.description ? { description: c.description } : {}) })) }] } };
    return this.postMessage({ to, type: "interactive", interactive });
  }

  async sendTemplate(to: string, template: string, language: LanguageCode, params: string[]): Promise<{ waMessageId: string }> {
    const build = (lang: LanguageCode) => ({
      to,
      type: "template",
      template: {
        name: template,
        language: { code: META_TEMPLATE_LANGUAGE[lang]! },
        ...(params.length ? { components: [{ type: "body", parameters: params.map((p) => ({ type: "text", text: templateParam(p, isRtl(lang)) })) }] } : {}),
      },
    });
    const lang = templateLanguageFor(language);
    try {
      return await this.postMessage(build(lang));
    } catch (e) {
      // Not (yet) approved in this language -> French, which is always submitted and approved first.
      if (e instanceof MetaApiError && e.metaCode === META_ERRORS.templateLanguage && lang !== "fr") return this.postMessage(build("fr"));
      throw e;
    }
  }

  /** Blue ticks on the person's message, so they see it arrived while the answer is being prepared. Best effort. */
  async markRead(waMessageId: string): Promise<void> {
    const res = await this.fetchImpl(`${this.base}/${this.config.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: waMessageId }),
    });
    if (!res.ok) return this.fail(res, "mark read");
  }

  async downloadMedia(mediaId: string): Promise<{ bytes: Buffer; mimeType: string }> {
    const meta = await this.fetchImpl(`${this.base}/${encodeURIComponent(mediaId)}`, { headers: this.headers(false) });
    if (!meta.ok) return this.fail(meta, "media lookup");
    const info = (await meta.json()) as { url: string; mime_type?: string };
    const file = await this.fetchImpl(info.url, { headers: this.headers(false) });
    if (!file.ok) return this.fail(file, "media download");
    return { bytes: Buffer.from(await file.arrayBuffer()), mimeType: info.mime_type ?? file.headers.get("content-type") ?? "application/octet-stream" };
  }
}

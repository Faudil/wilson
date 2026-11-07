import type { LanguageCode } from "@wilson/contracts";
import type { Config } from "../config.js";
import type { WhatsAppTransport } from "./transport.js";

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

  private async postMessage(payload: Record<string, unknown>): Promise<{ waMessageId: string }> {
    const res = await this.fetchImpl(`${this.base}/${this.config.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", ...payload }),
    });
    if (!res.ok) return this.fail(res, "send message");
    const j = (await res.json()) as { messages?: { id: string }[] };
    const id = j.messages?.[0]?.id;
    if (!id) throw new MetaApiError("send message: no message id in response", res.status);
    return { waMessageId: id };
  }

  sendText(to: string, body: string): Promise<{ waMessageId: string }> {
    return this.postMessage({ to, type: "text", text: { body, preview_url: false } });
  }

  async sendTemplate(to: string, template: string, language: LanguageCode, params: string[]): Promise<{ waMessageId: string }> {
    const build = (lang: string) => ({
      to,
      type: "template",
      template: {
        name: template,
        language: { code: lang },
        ...(params.length ? { components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text })) }] } : {}),
      },
    });
    try {
      return await this.postMessage(build(language));
    } catch (e) {
      // 132001: template not translated in this language -> fall back to French (always approved first).
      if (e instanceof MetaApiError && e.metaCode === 132001 && language !== "fr") return this.postMessage(build("fr"));
      throw e;
    }
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

import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { LANGUAGE_CODES, WaWebhookSchema } from "@wilson/contracts";
import { waText } from "@wilson/i18n";
import { letters } from "../src/db/schema.js";
import { MetaTransport, splitText, templateParam } from "../src/whatsapp/meta.js";
import { Graph, run } from "../src/whatsapp/setupCli.js";
import { META_TEMPLATE_LANGUAGE, TEMPLATE_LANGUAGES, templateDefinitions, templateLanguageFor } from "../src/whatsapp/templates.js";
import { handleWhatsAppWebhook } from "../src/whatsapp/webhook.js";
import { fakeHttp, makeWa, type WaCtx } from "./wa.helpers.js";

/** Records Graph calls and answers from a route table. */
function fakeFetch(routes: (url: string, body: any) => { status?: number; json: unknown } | undefined) {
  const calls: { url: string; method: string; body: any; auth?: string }[] = [];
  const impl = async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, method: init?.method ?? "GET", body, auth: (init?.headers as Record<string, string> | undefined)?.Authorization });
    const r = routes(url, body) ?? { json: {} };
    if (r.json instanceof Uint8Array) return new Response(Buffer.from(r.json), { status: r.status ?? 200, headers: { "content-type": "image/jpeg" } });
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  };
  return { calls, impl };
}
const cfg = { WHATSAPP_PHONE_NUMBER_ID: "PN1", WHATSAPP_ACCESS_TOKEN: "secret-token", WHATSAPP_GRAPH_VERSION: "v23.0" };
const ok = { json: { messages: [{ id: "wamid.X" }] } };

describe("MetaTransport (Graph API)", () => {
  it("sends text to /{phone_number_id}/messages with the bearer token, splitting texts over 4096 chars", async () => {
    const f = fakeFetch(() => ok);
    const t = new MetaTransport(cfg, f.impl);
    await t.sendText("33600000001", "hello");
    expect(f.calls[0]).toMatchObject({
      url: "https://graph.facebook.com/v23.0/PN1/messages", method: "POST", auth: "Bearer secret-token",
      body: { messaging_product: "whatsapp", to: "33600000001", type: "text", text: { body: "hello", preview_url: false } },
    });
    const long = Array.from({ length: 30 }, (_, i) => `Paragraph ${i} ` + "x".repeat(250)).join("\n\n");
    await t.sendText("33600000001", long);
    const parts = f.calls.slice(1).map((c) => c.body.text.body as string);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 4096)).toBe(true);
    expect(parts.join("\n\n")).toBe(long);
  });

  it("maps our language codes to Meta's, falls back for unsupported ones, and to French on 132001", async () => {
    const f = fakeFetch((_u, body) => (body?.template?.language?.code === "ar" ? { status: 400, json: { error: { code: 132001, message: "no translation" } } } : ok));
    const t = new MetaTransport(cfg, f.impl);
    await t.sendTemplate("1", "explanation_ready", "pt", []);
    await t.sendTemplate("1", "explanation_ready", "ps", []); // Pashto -> Dari
    await t.sendTemplate("1", "explanation_ready", "wo", []); // Wolof -> French
    await t.sendTemplate("1", "explanation_ready", "ar", []); // not approved yet -> French
    expect(f.calls.map((c) => c.body.template.language.code)).toEqual(["pt_PT", "fa", "fr", "ar", "fr"]);
    expect(f.calls[0]!.body.template.components).toBeUndefined();
  });

  it("cleans template parameters (no newline, no empty value) and isolates them in RTL templates", async () => {
    expect(templateParam("a\n b   c", false)).toBe("a b c");
    expect(templateParam("  ", false)).toBe("-");
    expect(templateParam("14/03/2027", true)).toBe("⁨14/03/2027⁩");
    const f = fakeFetch(() => ok);
    await new MetaTransport(cfg, f.impl).sendTemplate("1", "document_reminder", "fa", ["récépissé", "14 mars 2027"]);
    expect(f.calls[0]!.body.template.components[0].parameters.map((p: { text: string }) => p.text)).toEqual(["⁨récépissé⁩", "⁨14 mars 2027⁩"]);
  });

  it("downloads media in two steps (lookup, then authenticated download) and marks messages read", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 1, 2, 3]);
    const f = fakeFetch((url) => (url.endsWith("/MEDIA1") ? { json: { url: "https://lookaside.fbsbx.com/x?id=1", mime_type: "image/jpeg" } } : url.startsWith("https://lookaside") ? { json: bytes } : ok));
    const t = new MetaTransport(cfg, f.impl);
    const m = await t.downloadMedia("MEDIA1");
    expect(m.mimeType).toBe("image/jpeg");
    expect([...m.bytes]).toEqual([...bytes]);
    expect(f.calls.map((c) => c.auth)).toEqual(["Bearer secret-token", "Bearer secret-token"]);
    await t.markRead("wamid.IN");
    expect(f.calls[2]!.body).toEqual({ messaging_product: "whatsapp", status: "read", message_id: "wamid.IN" });
  });

  it("errors carry the Meta code but never the token", async () => {
    const f = fakeFetch(() => ({ status: 401, json: { error: { code: 190, message: "Invalid OAuth access token" } } }));
    const err = await new MetaTransport(cfg, f.impl).sendText("1", "x").catch((e: Error) => e);
    expect(err).toMatchObject({ metaCode: 190, status: 401 });
    expect(String((err as Error).message)).not.toContain("secret-token");
  });

  it("splitText keeps short texts intact", () => {
    expect(splitText("abc")).toEqual(["abc"]);
  });
});

describe("message templates submitted to Meta", () => {
  const defs = templateDefinitions({ associationName: "Association Wilson", names: { explanation_ready: "explanation_ready", document_reminder: "document_reminder" } });

  it("exist for every language Meta supports, and every language resolves to one of them", () => {
    expect(TEMPLATE_LANGUAGES).toContain("fr");
    expect(defs).toHaveLength(TEMPLATE_LANGUAGES.length * 2);
    for (const l of LANGUAGE_CODES) expect(TEMPLATE_LANGUAGES).toContain(templateLanguageFor(l));
    expect(new Set(defs.map((d) => `${d.name}/${d.language}`)).size).toBe(defs.length);
  });

  it("follow Meta's rules: no variable at start/end, ordered variables with examples, length limits", () => {
    for (const d of defs) {
      const body = d.components.find((c) => c.type === "BODY") as { text: string; example?: { body_text: string[][] } };
      const where = `${d.name}/${d.language}`;
      expect(body.text.length, where).toBeLessThanOrEqual(1024);
      expect(body.text, where).not.toMatch(/^\s*\{\{|\}\}\s*$/);
      expect(body.text, where).not.toContain("{association}");
      const vars = [...body.text.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
      expect(vars, where).toEqual(vars.map((_, i) => i + 1));
      if (vars.length) expect(body.example!.body_text[0]!.length, where).toBe(vars.length);
      const buttons = d.components.find((c) => c.type === "BUTTONS") as { buttons: { text: string }[] } | undefined;
      for (const b of buttons?.buttons ?? []) expect(b.text.length, where).toBeLessThanOrEqual(25);
      expect(d.category).toBe("UTILITY");
    }
    expect(defs.find((d) => d.language === "pt_PT")).toBeTruthy();
    expect(Object.values(META_TEMPLATE_LANGUAGE).filter(Boolean)).toHaveLength(TEMPLATE_LANGUAGES.length);
  });
});

describe("webhook with real Meta payloads (meta mode)", () => {
  let t: WaCtx;
  beforeAll(async () => {
    t = await makeWa({ meta: true, now: "2026-11-06T09:00:00Z" });
    t.tllm.nextLanguage = { language: "en", confidence: 0.95 };
  });
  afterAll(() => t.close());

  const sign = (body: string) => "sha256=" + createHmac("sha256", "appsecret").update(body).digest("hex");
  async function post(value: Record<string, unknown>, phoneNumberId = "123") {
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "WABA", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { display_phone_number: "33100000000", phone_number_id: phoneNumberId }, contacts: [{ profile: { name: "X" }, wa_id: "1" }], ...value } }] }] });
    const h = fakeHttp("POST", "/webhooks/whatsapp", { "x-hub-signature-256": sign(body) }, body);
    await handleWhatsAppWebhook(h.req, h.res, t.wdeps);
    await t.drain();
    return h.result.status;
  }
  const text = (id: string, from: string, body: string) => ({ id, from, timestamp: "1700000000", type: "text", text: { body } });

  it("an unknown message type or status does not drop the rest of the payload", async () => {
    const status = await post({
      messages: [{ id: "wamid.u1", from: "33631000001", timestamp: "1", type: "order", order: { catalog_id: "c" } }, text("wamid.u2", "33631000001", "Hello, I need help")],
      statuses: [{ id: "wamid.zzz", status: "deleted", recipient_id: "1", timestamp: "1" }],
    });
    expect(status).toBe(200);
    const out = await t.outbound("33631000001");
    expect(out).toContain(waText("en", "welcome"));
    expect(t.meta!.read).toEqual(expect.arrayContaining(["wamid.u1", "wamid.u2"]));
    expect(WaWebhookSchema.safeParse({ object: "whatsapp_business_account", entry: [{ id: "e", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: "1" }, messages: [{ id: "a", from: "b", timestamp: "1", type: "interactive", interactive: { type: "nfm_reply", nfm_reply: {} } }] } }] }] }).success).toBe(true);
  });

  it("ignores events for another phone number of the same app", async () => {
    expect(await post({ messages: [text("wamid.o1", "33631000002", "Hello")] }, "999")).toBe(200);
    expect(await t.outbound("33631000002")).toEqual([]);
  });

  it("Meta's 131047 (window closed on its side) turns the reviewed reply into the opt-in template; the button releases it", async () => {
    const p = "33631000003";
    await t.say(p, "Hello, I need help");
    await t.photo(p);
    const { beneficiary } = await t.services.beneficiaries.findOrCreateByWaId(p);
    const [l] = await t.deps.db.select().from(letters).where(eq(letters.beneficiaryId, beneficiary.id));
    t.meta!.failNextText = 131047;
    t.meta!.templates.length = 0;
    await t.wdeps.letters.approve(l!.id, t.volunteerId);
    await t.drain();
    expect(t.meta!.templates).toEqual([{ to: p, template: "explanation_ready", params: [] }]);
    expect((await t.deps.db.select().from(letters).where(eq(letters.id, l!.id)))[0]!.awaitingOptIn).toBe(true);

    await post({ messages: [{ id: "wamid.btn1", from: p, timestamp: "1", type: "button", button: { text: "Receive", payload: "Receive" } }] });
    const [done] = await t.deps.db.select().from(letters).where(eq(letters.id, l!.id));
    expect(done!.status).toBe("sent");
    expect(t.meta!.texts.filter((m) => m.to === p && m.body.includes("TITLE"))).toHaveLength(1);
  });

  it("a button tap with nothing waiting shows the main menu", async () => {
    const p = "33631000004";
    await t.say(p, "Hello, I need help");
    const before = (await t.outbound(p)).length;
    await post({ messages: [{ id: "wamid.btn2", from: p, timestamp: "1", type: "button", button: { text: "Receive", payload: "Receive" } }] });
    const out = await t.outbound(p);
    expect(out).toHaveLength(before + 1);
    expect(out.at(-1)).toBe(waText("en", "main_menu"));
  });
});

describe("wa:setup CLI", () => {
  const env = { WHATSAPP_ACCESS_TOKEN: "tok", WHATSAPP_PHONE_NUMBER_ID: "PN1", WHATSAPP_BUSINESS_ACCOUNT_ID: "WABA1", ASSOCIATION_NAME: "Asso Test" };

  it("templates: submits only the missing ones, French first, with the association name", async () => {
    const f = fakeFetch((url) =>
      url.includes("/message_templates?") ? { json: { data: [{ name: "explanation_ready", language: "en", status: "APPROVED" }] } } : { json: { status: "PENDING" } });
    const logs: string[] = [];
    await run(["templates"], env, new Graph("tok", "v23.0", f.impl), (l) => logs.push(l));
    const posts = f.calls.filter((c) => c.method === "POST");
    expect(posts).toHaveLength(TEMPLATE_LANGUAGES.length * 2 - 1);
    expect(posts[0]!.body.language).toBe("fr");
    expect(posts[0]!.url).toBe("https://graph.facebook.com/v23.0/WABA1/message_templates");
    expect(posts[0]!.body.components[0].text).toContain("Asso Test");
    expect(logs.join("\n")).toContain("skip    explanation_ready/en");
  });

  it("check: reports missing subscription and unapproved French templates", async () => {
    const f = fakeFetch((url) => {
      if (url.includes("/PN1?")) return { json: { display_phone_number: "+33 1 00", verified_name: "Asso", platform_type: "CLOUD_API", status: "CONNECTED" } };
      if (url.endsWith("/subscribed_apps")) return { json: { data: [] } };
      if (url.includes("/message_templates?")) return { json: { data: [{ name: "explanation_ready", language: "fr", status: "PENDING" }] } };
      return undefined;
    });
    const logs: string[] = [];
    expect(await run(["check"], env, new Graph("tok", "v23.0", f.impl), (l) => logs.push(l))).toBe(1);
    const all = logs.join("\n");
    expect(all).toContain("wa:setup subscribe");
    expect(all).toContain("explanation_ready/fr is not approved");
    expect(all).toContain("MISSING");
  });

  it("register passes the PIN and the local-storage region", async () => {
    const f = fakeFetch(() => ({ json: { success: true } }));
    await run(["register", "--pin", "123456", "--region", "DE"], env, new Graph("tok", "v23.0", f.impl), () => {});
    expect(f.calls[0]).toMatchObject({ url: "https://graph.facebook.com/v23.0/PN1/register", body: { messaging_product: "whatsapp", pin: "123456", data_localization_region: "DE" } });
    await expect(run(["register", "--pin", "12"], env, new Graph("tok", "v23.0", f.impl), () => {})).rejects.toThrow(/6 digits/);
  });
});

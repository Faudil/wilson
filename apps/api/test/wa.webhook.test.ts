import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { handleWhatsAppWebhook } from "../src/whatsapp/webhook.js";
import { fakeHttp, makeWa, type WaCtx } from "./wa.helpers.js";

let t: WaCtx;
beforeAll(async () => {
  t = await makeWa({ meta: true });
  t.tllm.nextLanguage = { language: "ar", confidence: 0.95 };
});
afterAll(() => t.close());

const payload = (id: string, from: string, body: string) =>
  JSON.stringify({
    object: "whatsapp_business_account",
    entry: [{ id: "e", changes: [{ field: "messages", value: {
      messaging_product: "whatsapp", metadata: { phone_number_id: "123" },
      messages: [{ id, from, timestamp: "1", type: "text", text: { body } }],
    } }] }],
  });
const sign = (body: string, secret = "appsecret") => "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

describe("whatsapp webhook", () => {
  it("answers the GET verification challenge only with the right token", async () => {
    const ok = fakeHttp("GET", "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42");
    await handleWhatsAppWebhook(ok.req, ok.res, t.wdeps);
    expect(ok.result).toEqual({ status: 200, body: "42" });
    const bad = fakeHttp("GET", "/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42");
    await handleWhatsAppWebhook(bad.req, bad.res, t.wdeps);
    expect(bad.result.status).toBe(403);
  });

  it("rejects a bad or missing signature and processes nothing", async () => {
    const body = payload("wamid.bad", "33600000001", "مرحبا");
    for (const sig of [sign(body, "wrong"), undefined]) {
      const h = fakeHttp("POST", "/webhooks/whatsapp", sig ? { "x-hub-signature-256": sig } : {}, body);
      await handleWhatsAppWebhook(h.req, h.res, t.wdeps);
      expect(h.result.status).toBe(401);
    }
    await t.drain();
    expect(await t.outbound("33600000001")).toEqual([]);
  });

  it("accepts a valid signature: first contact in Arabic sets the language and sends the welcome; duplicates are ignored", async () => {
    const body = payload("wamid.ok1", "33600000002", "مرحبا، أريد مساعدة");
    for (let i = 0; i < 2; i++) {
      const h = fakeHttp("POST", "/webhooks/whatsapp", { "x-hub-signature-256": sign(body) }, body);
      await handleWhatsAppWebhook(h.req, h.res, t.wdeps);
      expect(h.result.status).toBe(200);
    }
    await t.drain();
    const { beneficiary } = await t.services.beneficiaries.findOrCreateByWaId("33600000002");
    expect(beneficiary.language).toBe("ar");
    expect(beneficiary.languageConfirmed).toBe(true);
    expect(beneficiary.conversationState).toEqual({ step: "main_menu" });
    const { waText } = await import("@wilson/i18n");
    const out = await t.outbound("33600000002");
    expect(out[0]).toBe(waText("ar", "welcome"));
    expect(out).toHaveLength(2); // welcome + main menu, once
    expect(t.meta!.texts).toHaveLength(2);
  });

  it("unknown language on first contact shows the language menu; numbers (Arabic-Indic too) pick a language", async () => {
    t.tllm.nextLanguage = { language: null, confidence: 0 };
    await t.say("33600000003", "???");
    const { waText, LANGUAGE_MENU_HEADER } = await import("@wilson/i18n");
    expect((await t.outbound("33600000003"))[0]).toBe(`${LANGUAGE_MENU_HEADER}\n\n${waText("fr", "language_menu")}`);
    await t.say("33600000003", "٣"); // 3 = Arabic
    const { beneficiary } = await t.services.beneficiaries.findOrCreateByWaId("33600000003");
    expect(beneficiary.language).toBe("ar");
  });
});

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { LANGUAGE_CODES } from "@wilson/contracts";
import { LANGUAGE_MENU, waText } from "@wilson/i18n";
import { processInbound } from "../src/conversation/engine.js";
import { letters } from "../src/db/schema.js";
import { toInteractive } from "../src/whatsapp/interactive.js";
import { MetaTransport } from "../src/whatsapp/meta.js";
import { letterOfferText } from "../src/whatsapp/send.js";
import { makeWa, type WaCtx } from "./wa.helpers.js";

describe("toInteractive (numbered menu -> WhatsApp buttons / list)", () => {
  it("turns every catalog's main menu into a list whose ids are the typed numbers", () => {
    for (const l of LANGUAGE_CODES) {
      const m = toInteractive(waText(l, "main_menu"));
      expect(m, l).not.toBeNull();
      expect(m!.kind).toBe("list");
      expect(m!.choices.map((c) => c.id)).toEqual(["1", "2", "3", "4", "5", "6", "0", "9"]);
      expect(m!.choices.every((c) => c.title.length <= 24 && (c.description ?? "").length <= 72 && !/[\u200e\u200f\u2066-\u2069]/.test(c.title)), l).toBe(true);
      expect(m!.listButton.length).toBeLessThanOrEqual(20);
      expect(m!.body).not.toMatch(/^\s*\d - /m);
    }
  });

  it("uses reply buttons for 2-3 short options and a list when a label is too long for a button", () => {
    const yesNo = toInteractive("Is this right?\n1 - Yes\n2 - Change the date");
    expect(yesNo).toMatchObject({ kind: "buttons", body: "Is this right?", choices: [{ id: "1", title: "Yes" }, { id: "2", title: "Change the date" }] });
    const offer = toInteractive(letterOfferText("en"))!;
    expect(offer.kind).toBe("list"); // "No (the photo will be deleted)" is longer than 20
    expect(offer.choices.map((c) => c.id)).toEqual(["1", "2", "3"]);
  });

  it("leaves texts that are not a menu (or too big for one) as plain text", () => {
    expect(toInteractive("Hello! Send me a photo.")).toBeNull();
    expect(toInteractive(LANGUAGE_MENU)).toBeNull(); // 28 options > 10 rows
    expect(toInteractive("Only one\n1 - Yes")).toBeNull();
  });

  it("MetaTransport posts reply buttons and lists in Graph API shape", async () => {
    const calls: Record<string, unknown>[] = [];
    const impl = (async (_u: string, init?: RequestInit) => {
      calls.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ messages: [{ id: "wamid.X" }] }), { status: 200 });
    }) as typeof fetch;
    const t = new MetaTransport({ WHATSAPP_PHONE_NUMBER_ID: "PN1", WHATSAPP_ACCESS_TOKEN: "x", WHATSAPP_GRAPH_VERSION: "v23.0" } as never, impl);
    await t.sendInteractive("336", toInteractive("Ok?\n1 - Yes\n2 - No")!);
    await t.sendInteractive("336", toInteractive(waText("en", "main_menu"))!);
    expect(calls[0]).toMatchObject({ to: "336", type: "interactive", interactive: { type: "button", body: { text: "Ok?" }, action: { buttons: [{ type: "reply", reply: { id: "1", title: "Yes" } }, { type: "reply", reply: { id: "2", title: "No" } }] } } });
    expect(calls[1]).toMatchObject({ type: "interactive", interactive: { type: "list", action: { button: "☰ 1·2·3·4·5·6·0·9" } } });
  });
});

describe("tapping buttons and asking for more explanation (sandbox engine)", () => {
  let t: WaCtx;
  beforeAll(async () => {
    t = await makeWa();
  });
  afterAll(() => t.close());

  const tap = async (phone: string, id: string, title: string) => {
    await processInbound(t.wdeps, { id: `wamid.${randomUUID()}`, from: phone, timestamp: "1", type: "interactive", interactive: { type: "list_reply", list_reply: { id, title } } });
    await t.drain();
  };

  it("a list tap is routed by its id, like typing the number", async () => {
    const p = "33612000001";
    await t.say(p, "hello");
    await t.say(p, "2"); // English
    await tap(p, "1", "Explain a letter");
    expect((await t.outbound(p)).at(-1)).toBe(waText("en", "letter_ask_photo"));
  });

  it("the letter reply is short; '3' sends the details (summary + who can help, footer) and asks again", async () => {
    const p = "33612000002";
    await t.say(p, "hello");
    await t.say(p, "2");
    await t.say(p, "1");
    await t.photo(p);
    const { beneficiary } = await t.services.beneficiaries.findOrCreateByWaId(p);
    const [l] = await t.deps.db.select().from(letters).where(eq(letters.beneficiaryId, beneficiary.id));
    await t.wdeps.letters.approve(l!.id, t.volunteerId);
    await t.drain();
    let out = await t.outbound(p);
    const reply = out.find((m) => m.includes("TITLE"))!;
    expect(reply).toContain("ACTION");
    expect(reply).not.toContain("SUMMARY");
    expect(reply).toContain(t.config.ASSOCIATION_CONTACT); // the legal footer stays on the explanation
    expect(out.at(-1)).toBe(letterOfferText("en"));

    await tap(p, "3", "More explanation");
    out = await t.outbound(p);
    const details = out.at(-2)!;
    expect(details).toContain("SUMMARY");
    expect(details).toContain("ORIENT");
    expect(details).toContain(t.config.ASSOCIATION_CONTACT);
    expect(out.at(-1)).toBe(letterOfferText("en"));
    expect((await t.services.beneficiaries.get(beneficiary.id))!.conversationState).toEqual({ step: "offer_save_letter", letterId: l!.id });
  });
});

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { waText } from "@wilson/i18n";
import { Channels } from "../src/channels/registry.js";
import { receiveInbound } from "../src/channels/receive.js";
import type { ChannelTransport, InboundMessage } from "../src/channels/types.js";
import { windowOpen } from "../src/whatsapp/send.js";
import { makeWa, type WaCtx } from "./wa.helpers.js";

/** A second channel the way Telegram would plug in: no 24 h window, no buttons, ids prefixed with the channel. */
class FakeTelegram implements ChannelTransport {
  readonly channel = "telegram" as const;
  readonly mode = "fake";
  readonly capabilities = { serviceWindow: false };
  texts: { to: string; body: string }[] = [];
  read: string[] = [];
  async sendText(to: string, body: string) {
    this.texts.push({ to, body });
    return { waMessageId: `telegram:out-${this.texts.length}` };
  }
  async downloadMedia(): Promise<never> {
    throw new Error("n/a");
  }
  async markRead(id: string) {
    this.read.push(id);
  }
}

let t: WaCtx;
const tg = new FakeTelegram();
let seq = 0;
const tgText = (from: string, text: string): InboundMessage => ({ channel: "telegram", id: `telegram:${++seq}`, from, content: { type: "text", text } });

beforeAll(async () => {
  t = await makeWa({ meta: true, now: "2026-11-06T09:00:00Z" });
  t.tllm.nextLanguage = { language: "en", confidence: 0.95 };
  // The same object is shared by the workers, so swapping the registry here is what main.ts's createChannels does.
  const channels = new Channels([t.wdeps.channels.get("whatsapp"), tg]);
  t.wdeps.channels = channels;
  t.deps.channels = channels;
});
afterAll(() => t.close());

describe("messaging channels", () => {
  it("a message on another channel gets its replies on that channel, as plain text, with a read receipt", async () => {
    const msg = tgText("777001", "Hello, I need help");
    await receiveInbound(t.wdeps, msg);
    await receiveInbound(t.wdeps, msg); // delivered twice: processed once
    await t.drain();
    expect(tg.texts.map((m) => m.to)).toEqual(["777001", "777001"]);
    expect(tg.texts[0]!.body).toBe(waText("en", "welcome"));
    expect(tg.texts[1]!.body).toBe(waText("en", "main_menu")); // no sendInteractive: the menu as text
    expect(tg.read).toContain(msg.id);
    expect(t.meta!.texts.some((m) => m.to === "777001")).toBe(false);
  });

  it("the same digits on WhatsApp and on Telegram are two people; each channel keeps its own address", async () => {
    const onTg = await t.services.beneficiaries.findOrCreate("telegram", "777001");
    expect(onTg.created).toBe(false);
    const onWa = await t.services.beneficiaries.findOrCreateByWaId("777001");
    expect(onWa.created).toBe(true);
    expect(onWa.beneficiary.id).not.toBe(onTg.beneficiary.id);
    expect(await t.services.beneficiaries.getAddress(onTg.beneficiary.id)).toEqual({ channel: "telegram", address: "777001" });
    expect(onTg.beneficiary.channel).toBe("telegram");
  });

  it("only WhatsApp has the 24 h window: two days later Telegram still gets free text", async () => {
    const twoDaysAgo = new Date(new Date("2026-11-06T09:00:00Z").getTime() - 48 * 3600 * 1000);
    expect(windowOpen(t.wdeps, { channel: "telegram", lastInboundAt: twoDaysAgo })).toBe(true);
    expect(windowOpen(t.wdeps, { channel: "whatsapp", lastInboundAt: twoDaysAgo })).toBe(false);
    expect(() => new Channels([tg, tg])).toThrow();
    expect(() => new Channels([tg]).get("sms")).toThrow("channel not configured: sms");
  });
});

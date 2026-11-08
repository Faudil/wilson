import type { LanguageCode } from "@wilson/contracts";
import type { ChannelId, ChannelTransport } from "./types.js";

/** The transports this server runs, one per channel. Built once in main.ts (`createChannels`). */
export class Channels {
  private readonly byId = new Map<ChannelId, ChannelTransport>();

  constructor(transports: ChannelTransport[]) {
    for (const t of transports) {
      if (this.byId.has(t.channel)) throw new Error(`two transports for channel ${t.channel}`);
      this.byId.set(t.channel, t);
    }
  }

  /** Throws for a channel this server does not run (a person who wrote on Telegram, Telegram since switched off). */
  get(channel: ChannelId): ChannelTransport {
    const t = this.byId.get(channel);
    if (!t) throw new Error(`channel not configured: ${channel}`);
    return t;
  }

  has(channel: ChannelId): boolean {
    return this.byId.has(channel);
  }

  list(): ChannelTransport[] {
    return [...this.byId.values()];
  }
}

/** Is the free-text window open for this person? Always, on channels without WhatsApp's 24 h rule. */
export function windowOpenFor(t: ChannelTransport, now: Date, lastInboundAt: Date | null, windowMs: number): boolean {
  if (!t.capabilities.serviceWindow) return true;
  return !!lastInboundAt && now.getTime() - lastInboundAt.getTime() < windowMs;
}

/** `sendTemplate`, with a clear error if a sender asks for one on a channel that has none. */
export function sendTemplateVia(t: ChannelTransport, address: string, template: string, language: LanguageCode, params: string[]): Promise<{ waMessageId: string }> {
  if (!t.sendTemplate) throw new Error(`channel ${t.channel} has no templates`);
  return t.sendTemplate(address, template, language, params);
}

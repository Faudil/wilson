import type { Config } from "../config.js";
import { MetaTransport } from "./meta.js";
import { SandboxTransport, type SandboxTransportDeps } from "./sandbox.js";
import type { WhatsAppTransport } from "./transport.js";
import { Channels } from "../channels/registry.js";

export { MetaTransport, SandboxTransport };
export { handleWhatsAppWebhook, processWebhookPayload } from "./webhook.js";
export { fromWhatsApp } from "./inbound.js";
export { registerWhatsAppWorkers } from "./workers.js";
export { registerWaDeps, getWaDeps, type WaDeps } from "./context.js";

/** Picks the transport from WHATSAPP_MODE. The sandbox needs db/crypto/blobs/beneficiaries; meta only the config. */
export function createTransport(deps: SandboxTransportDeps & { config: Config }): WhatsAppTransport {
  return deps.config.WHATSAPP_MODE === "meta" ? new MetaTransport(deps.config) : new SandboxTransport(deps);
}

/** Every channel this server runs. Add Telegram, SMS… here once they have a transport (see docs/channels.md). */
export function createChannels(deps: SandboxTransportDeps & { config: Config }): Channels {
  return new Channels([createTransport(deps)]);
}

import type { Config } from "../config.js";
import { MetaTransport } from "./meta.js";
import { SandboxTransport, type SandboxTransportDeps } from "./sandbox.js";
import type { WhatsAppTransport } from "./transport.js";
import { withWebAccounts } from "./web.js";

export { MetaTransport, SandboxTransport };
export { handleWhatsAppWebhook, processWebhookPayload } from "./webhook.js";
export { registerWhatsAppWorkers } from "./workers.js";
export { registerWaDeps, getWaDeps, type WaDeps } from "./context.js";

/** Picks the transport from WHATSAPP_MODE, and delivers to web accounts ("web:<id>") itself (see web.ts). */
export function createTransport(deps: SandboxTransportDeps & { config: Config }): WhatsAppTransport {
  return withWebAccounts(deps.config.WHATSAPP_MODE === "meta" ? new MetaTransport(deps.config) : new SandboxTransport(deps), deps);
}

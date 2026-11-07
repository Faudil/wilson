import { os } from "./base.js";

export const systemRouter = {
  health: os.system.health.handler(({ context }) => ({
    ok: true,
    mode: context.deps.config.WHATSAPP_MODE,
    llm: context.deps.config.LLM_MODE,
    chat: context.deps.config.CHAT_MODE,
    signup: context.deps.config.VOLUNTEER_SIGNUP === "on",
  })),
};

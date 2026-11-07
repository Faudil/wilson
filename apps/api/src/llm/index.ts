import type { Config } from "../config.js";
import { AnthropicProvider } from "./anthropic.js";
import { FakeProvider } from "./fake.js";
import type { LlmProvider } from "./provider.js";
import type { UsageMeter } from "../usage/service.js";

export { LlmError } from "./provider.js";
export type { LlmFile, LlmProvider } from "./provider.js";
export { AnthropicProvider } from "./anthropic.js";
export { FakeProvider } from "./fake.js";

export function createLlmProvider(config: Pick<Config, "LLM_MODE" | "ANTHROPIC_API_KEY" | "LLM_MODEL" | "LLM_FAST_MODEL">, meter?: UsageMeter): LlmProvider {
  if (config.LLM_MODE === "fake") return new FakeProvider();
  return new AnthropicProvider({ apiKey: config.ANTHROPIC_API_KEY, model: config.LLM_MODEL, fastModel: config.LLM_FAST_MODEL, meter });
}

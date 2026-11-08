/**
 * Public Claude API prices, USD per million tokens (platform.claude.com/docs/en/about-claude/pricing, checked
 * 2026-11). Cache write = 5-minute cache (1.25 × input). Used only to *estimate* cost in the back-office:
 * the Anthropic Console invoice is the reference. Update this table when prices change.
 */
interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Long-prompt tier: above `overTokens` prompt tokens, these prices apply to the whole call. */
  long?: { overTokens: number; input: number; output: number };
}

const p = (input: number, output: number, cacheRead = input * 0.1, long?: Price["long"]): Price => ({ input, output, cacheRead, cacheWrite: input * 1.25, long });

const PRICES: Record<string, Price> = {
  "claude-fable-5-1": p(10, 50, 0.25),
  "claude-fable-5": p(10, 50),
  "claude-opus-5-5": p(4, 20, 0.2),
  "claude-opus-5": p(5, 25),
  "claude-opus-4-8": p(5, 25),
  "claude-opus-4-7": p(5, 25),
  "claude-opus-4-6": p(5, 25),
  "claude-sonnet-5-5": p(2, 10, 0.2),
  "claude-sonnet-5": p(2, 10),
  "claude-sonnet-4-6": p(3, 15),
  "claude-haiku-5-5": p(0.1, 0.5, 0.01, { overTokens: 100_000, input: 0.5, output: 2.5 }),
  "claude-haiku-4-5": p(1, 5),
};

/** Exact id first, then the longest known id the model starts with (dated snapshots, `-latest` aliases…). */
export function priceFor(model: string): Price | null {
  const m = model.replace(/^(anthropic\.|us\.anthropic\.|eu\.anthropic\.)/, "");
  if (PRICES[m]) return PRICES[m];
  const key = Object.keys(PRICES).filter((k) => m.startsWith(`${k}-`) || m.startsWith(`${k}@`)).sort((a, b) => b.length - a.length)[0];
  return key ? PRICES[key]! : null;
}

export interface TokenCounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** Estimated cost of one call in millionths of a USD (integer), or null for a model without a known price. */
export function costMicroUsd(model: string, t: TokenCounts): number | null {
  const price = priceFor(model);
  if (!price) return null;
  const prompt = t.inputTokens + t.cacheReadTokens + t.cacheWriteTokens;
  const long = price.long && prompt > price.long.overTokens ? price.long : null;
  const input = long?.input ?? price.input;
  const output = long?.output ?? price.output;
  const scale = long ? long.input / price.input : 1;
  // tokens × (USD / 1M tokens) = micro-USD
  return Math.round(
    t.inputTokens * input + t.outputTokens * output + t.cacheReadTokens * price.cacheRead * scale + t.cacheWriteTokens * price.cacheWrite * scale,
  );
}

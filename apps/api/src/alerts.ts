/**
 * Security alerts: always written to the log, and posted to ALERT_WEBHOOK_URL when it is set.
 * Alerts never carry anything about the people we help (no name, phone number or message content): only counts and,
 * for account events, the volunteer's display name.
 * The same alert key is sent at most once per ALERT_COOLDOWN_MS, so a flood cannot flood the alert channel too.
 */
export const ALERT_COOLDOWN_MS = 10 * 60_000;

export interface AlertDeps {
  config: { ALERT_WEBHOOK_URL?: string };
  now: () => Date;
  /** Injectable for tests. */
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
}

const lastSent = new WeakMap<object, Map<string, number>>();
/** Sent alerts, newest last (tests and the "what happened" log). Bounded. */
export const recentAlerts: { at: string; key: string; text: string }[] = [];

export async function alert(deps: AlertDeps, key: string, text: string): Promise<void> {
  let seen = lastSent.get(deps.config);
  if (!seen) lastSent.set(deps.config, (seen = new Map()));
  const now = deps.now().getTime();
  const prev = seen.get(key);
  if (prev !== undefined && now - prev < ALERT_COOLDOWN_MS) return;
  seen.set(key, now);
  console.warn(`[security] ${text}`);
  recentAlerts.push({ at: new Date(now).toISOString(), key, text });
  if (recentAlerts.length > 200) recentAlerts.shift();
  const url = deps.config.ALERT_WEBHOOK_URL;
  if (!url) return;
  const body = JSON.stringify({ text: `Wilson: ${text}`, content: `Wilson: ${text}` });
  try {
    await (deps.fetch ?? fetch)(url, { method: "POST", headers: { "content-type": "application/json" }, body, signal: AbortSignal.timeout(5000) });
  } catch (e) {
    console.warn("[security] alert webhook failed", (e as Error).message);
  }
}

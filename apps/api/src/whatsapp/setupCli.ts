/**
 * WhatsApp Cloud API setup helper. Talks to the Graph API with the credentials in .env, prints no secret.
 *
 *   bun run --filter @wilson/api wa:setup check                 token, number, webhook subscription, templates
 *   bun run --filter @wilson/api wa:setup templates [--dry-run] submit missing templates (all supported languages)
 *   bun run --filter @wilson/api wa:setup subscribe             subscribe the app to the WABA's webhooks
 *   bun run --filter @wilson/api wa:setup register --pin 123456 [--region DE]
 *                                                            register the number (2-step PIN), optionally with
 *                                                            Cloud API local storage in a region (data at rest)
 *   bun run --filter @wilson/api wa:setup send-test 33612345678 send Meta's built-in hello_world template
 *
 * Reads only the WHATSAPP_* variables and ASSOCIATION_NAME, so it works before the rest of the app is configured.
 * See docs/whatsapp-setup.md.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { templateDefinitions } from "./templates.js";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface SetupEnv {
  WHATSAPP_ACCESS_TOKEN?: string;
  WHATSAPP_PHONE_NUMBER_ID?: string;
  WHATSAPP_BUSINESS_ACCOUNT_ID?: string;
  WHATSAPP_GRAPH_VERSION?: string;
  WHATSAPP_TEMPLATE_EXPLANATION_READY?: string;
  WHATSAPP_TEMPLATE_DOCUMENT_REMINDER?: string;
  ASSOCIATION_NAME?: string;
}

export class Graph {
  readonly base: string;
  constructor(private readonly token: string, version = "v23.0", private readonly fetchImpl: FetchLike = (u, i) => fetch(u, i)) {
    this.base = `https://graph.facebook.com/${version}`;
  }
  async call<T = any>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const res = await this.fetchImpl(`${this.base}/${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const json = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      const e = json?.error ?? {};
      throw new Error(`${method} ${path.split("?")[0]}: HTTP ${res.status}${e.code ? ` code ${e.code}` : ""} ${e.error_user_msg ?? e.message ?? ""}`.trim());
    }
    return json as T;
  }
}

const names = (env: SetupEnv) => ({
  explanation_ready: env.WHATSAPP_TEMPLATE_EXPLANATION_READY || "explanation_ready",
  document_reminder: env.WHATSAPP_TEMPLATE_DOCUMENT_REMINDER || "document_reminder",
});

function need(env: SetupEnv, ...keys: (keyof SetupEnv)[]): void {
  const missing = keys.filter((k) => !env[k]);
  if (missing.length) throw new Error(`missing in .env: ${missing.join(", ")} (see docs/whatsapp-setup.md)`);
}

async function existingTemplates(g: Graph, waba: string): Promise<Map<string, string>> {
  const found = new Map<string, string>(); // "name/lang" -> status
  let path: string | null = `${waba}/message_templates?fields=name,language,status&limit=200`;
  while (path) {
    const page: { data: { name: string; language: string; status: string }[]; paging?: { next?: string } } = await g.call("GET", path);
    for (const t of page.data) found.set(`${t.name}/${t.language}`, t.status);
    path = page.paging?.next ? page.paging.next.replace(`${g.base}/`, "") : null;
  }
  return found;
}

export async function check(env: SetupEnv, g: Graph, log = console.log): Promise<boolean> {
  need(env, "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_PHONE_NUMBER_ID");
  let ok = true;
  const n = await g.call("GET", `${env.WHATSAPP_PHONE_NUMBER_ID}?fields=display_phone_number,verified_name,quality_rating,code_verification_status,name_status,platform_type,status`);
  log(`Number      ${n.display_phone_number} "${n.verified_name}"  status=${n.status ?? "?"} platform=${n.platform_type ?? "?"} quality=${n.quality_rating ?? "?"} name=${n.name_status ?? "?"}`);
  if (n.platform_type && n.platform_type !== "CLOUD_API") {
    ok = false;
    log("  ✗ the number is not registered on the Cloud API yet: run `wa:setup register --pin <6 digits>`");
  }
  if (!env.WHATSAPP_BUSINESS_ACCOUNT_ID) {
    log("WABA        WHATSAPP_BUSINESS_ACCOUNT_ID not set: cannot check the webhook subscription and templates");
    return false;
  }
  const subs = await g.call<{ data: unknown[] }>("GET", `${env.WHATSAPP_BUSINESS_ACCOUNT_ID}/subscribed_apps`);
  if (subs.data.length) log(`Webhooks    app subscribed to the WABA ✓`);
  else {
    ok = false;
    log("Webhooks    ✗ no app subscribed to this WABA: run `wa:setup subscribe`");
  }
  const found = await existingTemplates(g, env.WHATSAPP_BUSINESS_ACCOUNT_ID);
  const wanted = templateDefinitions({ associationName: env.ASSOCIATION_NAME || "Association Wilson", names: names(env) });
  const byStatus = new Map<string, string[]>();
  for (const t of wanted) {
    const st = found.get(`${t.name}/${t.language}`) ?? "MISSING";
    byStatus.set(st, [...(byStatus.get(st) ?? []), `${t.name}/${t.language}`]);
  }
  for (const [st, list] of byStatus) log(`Templates   ${st.padEnd(9)} ${list.length}: ${list.join(" ")}`);
  for (const name of Object.values(names(env))) {
    if (found.get(`${name}/fr`) !== "APPROVED") {
      ok = false;
      log(`  ✗ ${name}/fr is not approved: it is the fallback for every language, nothing can be sent after 24 h without it`);
    }
  }
  if (byStatus.has("MISSING")) log("  → run `wa:setup templates` to submit the missing ones");
  return ok;
}

export async function submitTemplates(env: SetupEnv, g: Graph, opts: { dryRun?: boolean } = {}, log = console.log): Promise<number> {
  need(env, "WHATSAPP_ACCESS_TOKEN", "WHATSAPP_BUSINESS_ACCOUNT_ID");
  const found = opts.dryRun ? new Map<string, string>() : await existingTemplates(g, env.WHATSAPP_BUSINESS_ACCOUNT_ID!);
  // French first: every other language falls back to it.
  const defs = templateDefinitions({ associationName: env.ASSOCIATION_NAME || "Association Wilson", names: names(env) })
    .sort((a, b) => Number(b.language === "fr") - Number(a.language === "fr"));
  let submitted = 0;
  for (const t of defs) {
    const key = `${t.name}/${t.language}`;
    if (found.has(key)) {
      log(`skip    ${key} (${found.get(key)})`);
      continue;
    }
    if (opts.dryRun) {
      log(`would submit ${key}:\n${JSON.stringify(t, null, 2)}`);
      submitted++;
      continue;
    }
    try {
      const r = await g.call<{ status?: string }>("POST", `${env.WHATSAPP_BUSINESS_ACCOUNT_ID}/message_templates`, t);
      log(`submit  ${key} → ${r.status ?? "PENDING"}`);
      submitted++;
    } catch (e) {
      log(`fail    ${key}: ${(e as Error).message}`);
    }
  }
  log(`${submitted} template(s) ${opts.dryRun ? "to submit" : "submitted"}. Meta usually reviews utility templates within minutes to a few hours.`);
  return submitted;
}

function arg(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}

export async function run(argv: string[], env: SetupEnv, g?: Graph, log = console.log): Promise<number> {
  const cmd = argv[0];
  need(env, "WHATSAPP_ACCESS_TOKEN");
  const graph = g ?? new Graph(env.WHATSAPP_ACCESS_TOKEN!, env.WHATSAPP_GRAPH_VERSION || "v23.0");
  switch (cmd) {
    case "check":
      return (await check(env, graph, log)) ? 0 : 1;
    case "templates":
      await submitTemplates(env, graph, { dryRun: argv.includes("--dry-run") }, log);
      return 0;
    case "subscribe":
      need(env, "WHATSAPP_BUSINESS_ACCOUNT_ID");
      await graph.call("POST", `${env.WHATSAPP_BUSINESS_ACCOUNT_ID}/subscribed_apps`);
      log("App subscribed to the WABA's webhooks. Make sure the webhook URL and the 'messages' field are set in the app dashboard.");
      return 0;
    case "register": {
      need(env, "WHATSAPP_PHONE_NUMBER_ID");
      const pin = arg(argv, "--pin");
      if (!pin || !/^\d{6}$/.test(pin)) throw new Error("register needs --pin <6 digits> (the number's two-step verification PIN; it is set if none exists yet)");
      const region = arg(argv, "--region");
      await graph.call("POST", `${env.WHATSAPP_PHONE_NUMBER_ID}/register`, {
        messaging_product: "whatsapp", pin, ...(region ? { data_localization_region: region } : {}),
      });
      log(`Number registered on the Cloud API${region ? ` with local storage in ${region}` : ""}.`);
      return 0;
    }
    case "send-test": {
      need(env, "WHATSAPP_PHONE_NUMBER_ID");
      const to = (argv[1] ?? "").replace(/[^\d]/g, "");
      if (!to) throw new Error("send-test needs a phone number in international format, e.g. 33612345678");
      const r = await graph.call<{ messages?: { id: string }[] }>("POST", `${env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
        messaging_product: "whatsapp", to, type: "template", template: { name: "hello_world", language: { code: "en_US" } },
      });
      log(`Sent hello_world (${r.messages?.[0]?.id ?? "no id"}). Reply to it from that phone to test the webhook.`);
      return 0;
    }
    default:
      log("usage: wa:setup check | templates [--dry-run] | subscribe | register --pin 123456 [--region DE] | send-test <phone>");
      return cmd ? 1 : 0;
  }
}

if (import.meta.main) {
  for (const f of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env"), resolve(process.cwd(), "../../.env.local")]) {
    if (existsSync(f)) {
      process.loadEnvFile(f);
      break;
    }
  }
  run(process.argv.slice(2), process.env as SetupEnv).then(
    (code) => process.exit(code),
    (e: Error) => {
      console.error(e.message);
      process.exit(1);
    },
  );
}

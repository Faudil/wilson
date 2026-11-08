import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import type { ContractRouterClient } from "@orpc/contract";
import type { contract } from "@wilson/contracts";
import { beneficiaries } from "../src/db/schema.js";
import type { KnowledgeService } from "../src/knowledge/types.js";
import { registerWorkers } from "../src/jobs/workers.js";
import { createLettersService } from "../src/letters/service.js";
import { FakeProvider, resolveSamplesDir } from "../src/llm/fake.js";
import { adoptServices } from "../src/services.js";
import { registerWaDeps, type WaDeps } from "../src/whatsapp/context.js";
import { SandboxTransport } from "../src/whatsapp/sandbox.js";
import { Channels } from "../src/channels/registry.js";
import { createVolunteer, makeClient, makeTestDeps, type TestCtx } from "./helpers.js";

export type Client = ContractRouterClient<typeof contract>;

export interface E2E extends TestCtx {
  wdeps: WaDeps;
  fake: FakeProvider;
  client: Client;
  /** Fake phone talking to the bot through the public sandbox RPC (queue drained after each call). */
  phone(number: string): Phone;
}
export interface Phone {
  number: string;
  say(text: string): Promise<void>;
  send(file: File): Promise<void>;
  /** Decrypted messages of the sandbox thread (RPC), oldest first. */
  thread(): Promise<{ direction: "inbound" | "outbound"; text: string | null; hasMedia: boolean }[]>;
  out(): Promise<string[]>;
  last(): Promise<string>;
  /** 📎 → Location. */
  share(latitude: number, longitude: number): Promise<void>;
}

export const sampleFile = (kind: "letters" | "documents", name: string): File => {
  const bytes = readFileSync(join(resolveSamplesDir(), kind, name));
  return new File([new Uint8Array(bytes)], name, { type: "image/png" });
};

/** Full stack as in main.ts (real services + workers + router), but FakeProvider, SandboxTransport, InlineQueue, fixed clock. */
export async function makeE2E(opts: { now?: string; config?: Record<string, string | undefined>; knowledge?: KnowledgeService } = {}): Promise<E2E> {
  const ctx = await makeTestDeps({ now: opts.now ?? "2026-11-06T12:00:00Z", config: opts.config });
  const fake = new FakeProvider();
  const ben = ctx.services.beneficiaries;
  const wa = new SandboxTransport({ db: ctx.deps.db, crypto: ctx.deps.crypto, blobs: ctx.deps.blobs, beneficiaries: ben });
  const deps = { ...ctx.deps, llm: fake, channels: new Channels([wa]) };
  const letters = createLettersService(deps, ben, opts.knowledge);
  const wdeps: WaDeps = { ...deps, beneficiaries: ben, documents: ctx.services.documents, letters };
  adoptServices(ctx.deps, deps, wdeps);
  registerWaDeps(wdeps);
  await registerWorkers(wdeps, ctx.queue);
  const v = await createVolunteer(ctx.deps);
  const { client } = makeClient(ctx.deps);
  await client.auth.login({ email: v.email, password: v.password });

  const phone = (number: string): Phone => {
    const p: Phone = {
      number,
      async say(text) {
        await client.sandbox.send({ phone: number, text });
        await ctx.queue.drain();
      },
      async send(file) {
        await client.sandbox.send({ phone: number, file });
        await ctx.queue.drain();
      },
      async share(latitude, longitude) {
        await client.sandbox.send({ phone: number, location: { latitude, longitude } });
        await ctx.queue.drain();
      },
      thread: async () => (await client.sandbox.thread({ phone: number })).map(({ direction, text, hasMedia }) => ({ direction, text, hasMedia })),
      out: async () => (await p.thread()).filter((m) => m.direction === "outbound").map((m) => m.text ?? ""),
      last: async () => (await p.out()).at(-1) ?? "",
    };
    return p;
  };
  return { ...ctx, wdeps, fake, client, phone };
}

export async function beneficiaryIdOf(t: E2E, phone: string): Promise<string> {
  const [b] = await t.deps.db.select().from(beneficiaries).where(eq(beneficiaries.waIdHash, t.deps.crypto.lookupHash(phone)));
  return b!.id;
}

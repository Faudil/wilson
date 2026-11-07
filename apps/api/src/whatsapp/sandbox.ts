import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { LanguageCode } from "@wilson/contracts";
import type { BeneficiariesService } from "../beneficiaries/service.js";
import type { Crypto } from "../crypto/keys.js";
import type { Db } from "../db/client.js";
import { beneficiaries as beneficiariesTable, messages } from "../db/schema.js";
import type { BlobStore } from "../storage/blobStore.js";
import type { Interactive } from "./interactive.js";
import type { WhatsAppTransport } from "./transport.js";

export interface SandboxTransportDeps {
  db: Db;
  crypto: Crypto;
  blobs: BlobStore;
  beneficiaries: BeneficiariesService;
}

/** Sandbox media ids look like `sandbox/<beneficiaryId>/<uuid>`; the blob is `mime \n bytes`, encrypted with the beneficiary DEK. */
const SANDBOX_MEDIA_PREFIX = "sandbox/";

export async function putSandboxMedia(deps: SandboxTransportDeps, beneficiaryId: string, bytes: Buffer, mimeType: string): Promise<string> {
  const dek = await deps.beneficiaries.getDek(beneficiaryId);
  const key = `${SANDBOX_MEDIA_PREFIX}${beneficiaryId}/${randomUUID()}`;
  await deps.blobs.put(key, deps.crypto.encrypt(dek, Buffer.concat([Buffer.from(`${mimeType}\n`), bytes])));
  return key;
}

/** Nothing leaves the server: outbound messages are written to `messages`, inbound media read from the blob store. */
export class SandboxTransport implements WhatsAppTransport {
  readonly mode = "sandbox" as const;
  constructor(private readonly deps: SandboxTransportDeps) {}

  private async record(to: string, kind: "text" | "template" | "interactive", body: string): Promise<{ waMessageId: string }> {
    const { db, crypto, beneficiaries } = this.deps;
    const [row] = await db.select({ id: beneficiariesTable.id }).from(beneficiariesTable).where(eq(beneficiariesTable.waIdHash, crypto.lookupHash(to))).limit(1);
    if (!row) throw new Error("sandbox: unknown recipient");
    const dek = await beneficiaries.getDek(row.id);
    const waMessageId = `sandbox.out.${randomUUID()}`;
    await db.insert(messages).values({
      beneficiaryId: row.id, direction: "out", kind, waMessageId, bodyEnc: crypto.encrypt(dek, body), status: "sent",
    });
    return { waMessageId };
  }

  sendText(to: string, body: string) {
    return this.record(to, "text", body);
  }

  /** Recorded as the plain menu text, kind "interactive": the sandbox page draws the buttons from it. */
  sendInteractive(to: string, _m: Interactive, fallbackText: string) {
    return this.record(to, "interactive", fallbackText);
  }

  sendTemplate(to: string, template: string, language: LanguageCode, params: string[]) {
    return this.record(to, "template", `[template ${template} / ${language}] ${params.join(" | ")}`.trim());
  }

  async downloadMedia(mediaId: string): Promise<{ bytes: Buffer; mimeType: string }> {
    const m = /^sandbox\/([0-9a-f-]{36})\/[0-9a-f-]{36}$/.exec(mediaId);
    if (!m) throw new Error("sandbox: bad media id");
    const dek = await this.deps.beneficiaries.getDek(m[1]!);
    const plain = this.deps.crypto.decrypt(dek, await this.deps.blobs.get(mediaId));
    const nl = plain.indexOf(0x0a);
    return { mimeType: plain.subarray(0, nl).toString("utf8"), bytes: plain.subarray(nl + 1) };
  }
}

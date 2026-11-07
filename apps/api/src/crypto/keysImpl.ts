import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import type { Config } from "../config.js";
import type { Crypto } from "./keys.js";

const IV_LEN = 12;
const TAG_LEN = 16;

function seal(key: Buffer, plaintext: Buffer | string): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(typeof plaintext === "string" ? Buffer.from(plaintext, "utf8") : plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

function open(key: Buffer, data: Buffer): Buffer {
  if (data.length < IV_LEN + TAG_LEN) throw new Error("ciphertext too short");
  const iv = data.subarray(0, IV_LEN);
  const tag = data.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data.subarray(IV_LEN + TAG_LEN)), decipher.final()]);
}

/** AES-256-GCM envelope encryption. Ciphertext = iv(12) | tag(16) | ct. DEKs are wrapped with MASTER_KEY. */
export function createCrypto(config: Pick<Config, "MASTER_KEY" | "LOOKUP_KEY">): Crypto {
  const master = Buffer.from(config.MASTER_KEY, "base64");
  const lookup = Buffer.from(config.LOOKUP_KEY, "base64");
  if (master.length !== 32 || lookup.length !== 32) throw new Error("MASTER_KEY and LOOKUP_KEY must be 32 bytes");
  return {
    newDek() {
      const dek = randomBytes(32);
      return { dek, wrapped: seal(master, dek) };
    },
    unwrapDek: (wrapped) => open(master, wrapped),
    encrypt: seal,
    decrypt: open,
    encryptJson: (dek, value) => seal(dek, JSON.stringify(value)),
    decryptJson: <T>(dek: Buffer, ct: Buffer) => JSON.parse(open(dek, ct).toString("utf8")) as T,
    lookupHash: (value) => createHmac("sha256", lookup).update(value).digest("hex"),
  };
}

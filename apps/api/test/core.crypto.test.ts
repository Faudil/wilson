import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createCrypto } from "../src/crypto/keysImpl.js";
import { testConfig } from "./helpers.js";

describe("crypto", () => {
  const crypto = createCrypto(testConfig());

  it("round-trips bytes, strings and JSON under a DEK", () => {
    const { dek } = crypto.newDek();
    expect(dek).toHaveLength(32);
    const data = randomBytes(5000);
    const ct = crypto.encrypt(dek, data);
    expect(ct.length).toBe(12 + 16 + data.length);
    expect(crypto.decrypt(dek, ct).equals(data)).toBe(true);
    expect(crypto.decrypt(dek, crypto.encrypt(dek, "héllo ١٤")).toString("utf8")).toBe("héllo ١٤");
    expect(crypto.decryptJson(dek, crypto.encryptJson(dek, { a: [1, "é"] }))).toEqual({ a: [1, "é"] });
  });

  it("uses a fresh IV each time", () => {
    const { dek } = crypto.newDek();
    expect(crypto.encrypt(dek, "x").equals(crypto.encrypt(dek, "x"))).toBe(false);
  });

  it("wraps and unwraps DEKs with the master key only", () => {
    const { dek, wrapped } = crypto.newDek();
    expect(crypto.unwrapDek(wrapped).equals(dek)).toBe(true);
    const other = createCrypto(testConfig());
    expect(() => other.unwrapDek(wrapped)).toThrow();
  });

  it("fails on tampered ciphertext, tag, IV or wrong key", () => {
    const { dek } = crypto.newDek();
    const ct = crypto.encrypt(dek, "secret");
    for (const i of [0, 12, ct.length - 1]) {
      const bad = Buffer.from(ct);
      bad[i] = bad[i]! ^ 1;
      expect(() => crypto.decrypt(dek, bad)).toThrow();
    }
    expect(() => crypto.decrypt(randomBytes(32), ct)).toThrow();
    expect(() => crypto.decrypt(dek, Buffer.alloc(5))).toThrow();
  });

  it("lookupHash is deterministic, keyed and hex", () => {
    expect(crypto.lookupHash("33612345621")).toBe(crypto.lookupHash("33612345621"));
    expect(crypto.lookupHash("33612345621")).toMatch(/^[0-9a-f]{64}$/);
    expect(crypto.lookupHash("a")).not.toBe(crypto.lookupHash("b"));
    expect(createCrypto(testConfig()).lookupHash("a")).not.toBe(crypto.lookupHash("a"));
  });
});

import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import type { BlobStore } from "../storage/blobStore.js";

/**
 * Local runtime: blobs as files under DATA_DIR/blobs. Receives ciphertext only, exactly like S3
 * (callers encrypt with the beneficiary DEK before `put`).
 */
export class FsBlobStore implements BlobStore {
  private readonly root: string;
  constructor(dataDir: string) {
    this.root = resolve(dataDir, "blobs");
  }
  private path(key: string): string {
    const p = resolve(this.root, ...key.split("/"));
    if (!p.startsWith(this.root + sep)) throw new Error(`invalid blob key: ${key}`);
    return p;
  }
  async put(key: string, body: Buffer): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, body);
  }
  async get(key: string): Promise<Buffer> {
    return readFile(this.path(key));
  }
  async delete(key: string): Promise<void> {
    await rm(this.path(key), { force: true });
  }
  async copy(fromKey: string, toKey: string): Promise<void> {
    const to = this.path(toKey);
    await mkdir(dirname(to), { recursive: true });
    await copyFile(this.path(fromKey), to);
  }
}


import type { BlobStore } from "./blobStore.js";

/** In-memory BlobStore for tests. */
export class MemoryBlobStore implements BlobStore {
  readonly objects = new Map<string, { body: Buffer; contentType?: string }>();
  async put(key: string, body: Buffer, contentType?: string): Promise<void> {
    this.objects.set(key, { body: Buffer.from(body), contentType });
  }
  async get(key: string): Promise<Buffer> {
    const o = this.objects.get(key);
    if (!o) throw new Error(`blob not found: ${key}`);
    return Buffer.from(o.body);
  }
  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
  async copy(fromKey: string, toKey: string): Promise<void> {
    const o = this.objects.get(fromKey);
    if (!o) throw new Error(`blob not found: ${fromKey}`);
    this.objects.set(toKey, { body: Buffer.from(o.body), contentType: o.contentType });
  }
  has(key: string): boolean {
    return this.objects.has(key);
  }
}

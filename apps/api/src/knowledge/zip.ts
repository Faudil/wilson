import { inflateRawSync } from "node:zlib";

export interface ZipEntry {
  name: string;
  /** Uncompressed size according to the central directory. */
  size: number;
  read(): Buffer;
}

/**
 * Minimal ZIP reader (central directory + stored/deflate entries; no ZIP64, no encryption).
 * Enough for the DILA open-data archives. Throws on anything it does not understand.
 */
export function readZip(buf: Buffer): ZipEntry[] {
  const minEocd = 22;
  let eocd = -1;
  for (let i = buf.length - minEocd; i >= Math.max(0, buf.length - minEocd - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a ZIP file (end of central directory not found)");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || p === 0xffffffff) throw new Error("ZIP64 archives are not supported");
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("corrupt ZIP central directory");
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString(flags & 0x800 ? "utf8" : "latin1", p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name.endsWith("/")) continue;
    entries.push({
      name,
      size,
      read() {
        if (flags & 1) throw new Error(`${name}: encrypted entries are not supported`);
        if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error(`${name}: corrupt local header`);
        const start = localOffset + 30 + buf.readUInt16LE(localOffset + 26) + buf.readUInt16LE(localOffset + 28);
        const raw = buf.subarray(start, start + compSize);
        if (method === 0) return Buffer.from(raw);
        if (method === 8) return inflateRawSync(raw);
        throw new Error(`${name}: unsupported compression method ${method}`);
      },
    });
  }
  return entries;
}

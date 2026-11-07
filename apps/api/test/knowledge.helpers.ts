import { crc32, deflateRawSync, deflateSync } from "node:zlib";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SERVICE_PUBLIC_ZIP_URL } from "../src/knowledge/sources/servicePublic.js";
import { ANNUAIRE_URL } from "../src/knowledge/sources/annuaire.js";

export const FIXTURES = fileURLToPath(new URL("./fixtures/knowledge", import.meta.url));

/** Minimal ZIP writer (deflate), so tests need no archive library. */
export function makeZip(files: Record<string, string | Buffer>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content);
    const comp = deflateRawSync(data);
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x800, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(comp.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(nameBuf.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, nameBuf);
    offset += 30 + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

export function fichesZip(): Buffer {
  const dir = join(FIXTURES, "fiches");
  return makeZip(Object.fromEntries(readdirSync(dir).map((n) => [`export/${n}`, readFileSync(join(dir, n))])));
}

export const annuairePage = (): unknown => JSON.parse(readFileSync(join(FIXTURES, "annuaire-page.json"), "utf8"));

/** fetch() stand-in serving the fixtures; `calls` records requested URLs. */
export function fakeFetch(opts: { zip?: Buffer; annuaire?: unknown; status?: number } = {}) {
  const calls: string[] = [];
  const fn = (async (input: URL | string | Request) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push(url);
    if (opts.status && opts.status !== 200) return new Response("nope", { status: opts.status });
    if (url.startsWith(SERVICE_PUBLIC_ZIP_URL)) return new Response(new Uint8Array(opts.zip ?? fichesZip()));
    if (url.startsWith(ANNUAIRE_URL)) return Response.json(opts.annuaire ?? annuairePage());
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return Object.assign(fn, { calls });
}

/** A tiny PDF whose content stream is Flate-compressed (WinAnsi text, one heading + one paragraph). */
export function makePdf(lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/[\\()]/g, "\\$&").replace(/é/g, "\\351").replace(/è/g, "\\350").replace(/à/g, "\\340").replace(/ê/g, "\\352");
  const body = ["BT", "/F1 12 Tf", "72 720 Td", ...lines.map((l, i) => `${i === 0 ? "" : "0 -18 Td "}(${esc(l)}) Tj`), "ET"].join("\n");
  const stream = deflateSync(Buffer.from(body, "latin1"));
  return Buffer.concat([
    Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Filter /FlateDecode /Length " + stream.length + " >>\nstream\n", "latin1"),
    stream,
    Buffer.from("\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n", "latin1"),
  ]);
}

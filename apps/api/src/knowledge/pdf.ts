import { inflateSync } from "node:zlib";

/**
 * Best-effort PDF text extraction without dependencies.
 *
 * Handles: classic and object-stream layouts (all `stream…endstream` blocks are scanned, FlateDecode only),
 * text operators Tj / TJ / ' / ", line breaks from Td, TD, T-star, Tm and ET, literal and hex strings,
 * ToUnicode CMaps (merged across fonts) for 2-byte (CID) fonts.
 *
 * Limits: no encryption, no LZW/ASCII85 filters, no scanned (image-only) pages, font encodings other than
 * WinAnsi/Latin-1 or ToUnicode are not interpreted, and the per-font CMaps are merged (two fonts reusing the same
 * code for different glyphs can garble text). Page order = order of streams in the file. Always check the
 * extracted text of a guide by eye (`pnpm knowledge:sync watizat`, then the back-office search page).
 */

const CP1252: Record<number, string> = { 0x80: "€", 0x82: "‚", 0x83: "ƒ", 0x84: "„", 0x85: "…", 0x86: "†", 0x87: "‡", 0x88: "ˆ", 0x89: "‰", 0x8a: "Š", 0x8b: "‹", 0x8c: "Œ", 0x8e: "Ž", 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—", 0x98: "˜", 0x99: "™", 0x9a: "š", 0x9b: "›", 0x9c: "œ", 0x9e: "ž", 0x9f: "Ÿ" };
const latin = (b: number): string => CP1252[b] ?? String.fromCharCode(b);

function streams(buf: Buffer): Buffer[] {
  const out: Buffer[] = [];
  let pos = 0;
  for (;;) {
    const s = buf.indexOf("stream", pos, "latin1");
    if (s < 0) break;
    if (buf.subarray(Math.max(0, s - 3), s).toString("latin1") === "end") {
      pos = s + 6;
      continue;
    }
    let start = s + 6;
    if (buf[start] === 0x0d) start++;
    if (buf[start] === 0x0a) start++;
    const e = buf.indexOf("endstream", start, "latin1");
    if (e < 0) break;
    // Dictionary just before "stream" tells us the filter.
    const dict = buf.subarray(Math.max(0, s - 400), s).toString("latin1");
    const lastObj = dict.lastIndexOf("obj");
    const d = lastObj >= 0 ? dict.slice(lastObj) : dict;
    let data = buf.subarray(start, e);
    if (/\/FlateDecode|\/Fl\b/.test(d)) {
      try {
        data = inflateSync(data);
      } catch {
        try {
          data = inflateSync(data, { finishFlush: 2 /* Z_SYNC_FLUSH: tolerate truncated */ });
        } catch {
          data = Buffer.alloc(0);
        }
      }
    } else if (/\/(LZWDecode|ASCII85Decode|DCTDecode|JPXDecode|CCITTFaxDecode)/.test(d)) data = Buffer.alloc(0);
    out.push(data);
    pos = e + 9;
  }
  return out;
}

function hexToCode(h: string): { code: number; len: number } {
  const clean = h.replace(/\s+/g, "");
  return { code: parseInt(clean || "0", 16), len: clean.length / 2 };
}
const uni = (h: string): string => {
  const c = h.replace(/\s+/g, "");
  let s = "";
  for (let i = 0; i + 4 <= c.length; i += 4) s += String.fromCharCode(parseInt(c.slice(i, i + 4), 16));
  return s;
};

function parseCMap(text: string, map: Map<number, string>, widths: Set<number>): void {
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1]!.matchAll(/<([0-9a-fA-F\s]+)>\s*<([0-9a-fA-F\s]+)>/g)) {
      const { code, len } = hexToCode(m[1]!);
      widths.add(len);
      map.set(code, uni(m[2]!));
    }
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1]!.matchAll(/<([0-9a-fA-F\s]+)>\s*<([0-9a-fA-F\s]+)>\s*(<([0-9a-fA-F\s]+)>|\[([^\]]*)\])/g)) {
      const lo = hexToCode(m[1]!);
      const hi = hexToCode(m[2]!).code;
      widths.add(lo.len);
      if (m[4] !== undefined) {
        const base = uni(m[4]);
        for (let c = lo.code; c <= hi && c - lo.code < 0xffff; c++) map.set(c, base.slice(0, -1) + String.fromCharCode(base.charCodeAt(base.length - 1) + (c - lo.code)));
      } else {
        const items = [...(m[5] ?? "").matchAll(/<([0-9a-fA-F\s]+)>/g)].map((x) => uni(x[1]!));
        items.forEach((v, i) => map.set(lo.code + i, v));
      }
    }
  }
}

function decodeLiteral(raw: string): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]!;
    if (ch !== "\\") {
      bytes.push(raw.charCodeAt(i) & 0xff);
      continue;
    }
    const n = raw[++i];
    if (n === undefined) break;
    const esc: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12, "(": 40, ")": 41, "\\": 92 };
    if (n in esc) bytes.push(esc[n]!);
    else if (/[0-7]/.test(n)) {
      let o = n;
      while (o.length < 3 && /[0-7]/.test(raw[i + 1] ?? "")) o += raw[++i];
      bytes.push(parseInt(o, 8) & 0xff);
    } else if (n !== "\n" && n !== "\r") bytes.push(n.charCodeAt(0) & 0xff);
  }
  return bytes;
}

/** Tokens of interest in a content stream, in order. */
const TOKEN = /\((?:\\[\s\S]|[^\\()]|\((?:\\[\s\S]|[^\\()])*\))*\)|<([0-9a-fA-F\s]*)>|\[|\]|-?\d*\.?\d+|[A-Za-z'"*]+/g;

function contentText(content: string, cmap: Map<number, string>, widths: Set<number>): string {
  let out = "";
  const operands: (string | { str: number[] } | { hex: string } | number)[] = [];
  const decode = (s: { str: number[] } | { hex: string }): string => {
    if ("hex" in s) {
      const h = s.hex.replace(/\s+/g, "");
      if (cmap.size && (widths.has(2) || !widths.has(1))) {
        let r = "";
        for (let i = 0; i + 4 <= h.length; i += 4) r += cmap.get(parseInt(h.slice(i, i + 4), 16)) ?? "";
        return r;
      }
      let r = "";
      for (let i = 0; i + 2 <= h.length; i += 2) {
        const c = parseInt(h.slice(i, i + 2), 16);
        r += cmap.get(c) ?? latin(c);
      }
      return r;
    }
    return s.str.map((b) => cmap.get(b) ?? latin(b)).join("");
  };
  let inArray = false;
  const arr: string[] = [];
  const nl = () => {
    if (out && !out.endsWith("\n")) out += "\n";
  };
  TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(content))) {
    const t = m[0];
    if (t === "[") {
      inArray = true;
      arr.length = 0;
    } else if (t === "]") {
      inArray = false;
      operands.push(arr.join(""));
    } else if (t[0] === "(") {
      const s = { str: decodeLiteral(t.slice(1, -1)) };
      if (inArray) arr.push(decode(s));
      else operands.push(decode(s));
    } else if (t[0] === "<") {
      const s = { hex: m[1] ?? "" };
      if (inArray) arr.push(decode(s));
      else operands.push(decode(s));
    } else if (/^-?[\d.]/.test(t)) {
      if (inArray) {
        if (Number(t) < -250) arr.push(" ");
      } else operands.push(Number(t));
    } else {
      // operator
      switch (t) {
        case "Tj":
        case "TJ":
          out += String(operands.pop() ?? "");
          break;
        case "'":
        case '"':
          nl();
          out += String(operands.pop() ?? "");
          break;
        case "Td":
        case "TD": {
          const ty = Number(operands[operands.length - 1] ?? 0);
          if (ty !== 0) nl();
          else if (out && !/\s$/.test(out)) out += " ";
          break;
        }
        case "T*":
        case "Tm":
        case "ET":
          nl();
          break;
      }
      operands.length = 0;
    }
  }
  return out;
}

/** Extracts the text of a PDF. Returns "" when nothing could be decoded (scanned/encrypted PDF). */
export function extractPdfText(pdf: Buffer): string {
  const decoded = streams(pdf);
  const cmap = new Map<number, string>();
  const widths = new Set<number>();
  for (const d of decoded) {
    const s = d.toString("latin1");
    if (s.includes("begincmap")) parseCMap(s, cmap, widths);
  }
  const pages: string[] = [];
  for (const d of decoded) {
    if (d.length === 0) continue;
    const s = d.toString("latin1");
    if (s.includes("begincmap") || !/\bBT\b/.test(s)) continue;
    const t = contentText(s, cmap, widths);
    if (t.trim()) pages.push(t.trim());
  }
  return pages.join("\n\n").normalize("NFC");
}

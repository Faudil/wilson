// Back-office web server (Bun only, no Vite / nginx).
//   bun run dev    → development: bundles on the fly with hot reload, http://localhost:5173
//   bun run start  → production: serves the built dist/ with security headers (builds it first if missing)
// Both forward /rpc/* and /webhooks/* to the API (API_ORIGIN, default http://localhost:3000).
import { existsSync } from "node:fs";
import { join, normalize } from "node:path";
import index from "./index.html";
import { buildBackoffice } from "./build";
import { fontAssets } from "./fonts";

const production = process.argv.includes("--production") || process.env.NODE_ENV === "production";
const port = Number(process.env.WEB_PORT ?? 5173);
const apiOrigin = (process.env.API_ORIGIN ?? "http://localhost:3000").replace(/\/$/, "");
const dist = join(import.meta.dir, "dist");

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; font-src 'self'",
};

/** Compress JSON answers bigger than a TCP packet when the browser accepts gzip. */
function shouldCompress(req: Request, res: Response): boolean {
  const length = Number(res.headers.get("content-length") ?? Infinity);
  return (
    length > 1400 &&
    (res.headers.get("content-type") ?? "").includes("json") &&
    (req.headers.get("accept-encoding") ?? "").includes("gzip")
  );
}

/** Forward a request to the API unchanged (method, headers, cookies, body). */
async function proxy(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const headers = new Headers(req.headers);
  headers.delete("host");
  try {
    const res = await fetch(apiOrigin + url.pathname + url.search, {
      method: req.method,
      headers,
      body: req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer(),
      redirect: "manual",
    });
    // fetch() already decoded the body: drop the encoding headers so the browser doesn't decode twice.
    const out = new Headers(res.headers);
    out.delete("content-encoding");
    out.delete("content-length");
    // API answers are JSON (lists of letters, conversations…): gzip them, typically 5-10x smaller on the wire.
    if (res.body && shouldCompress(req, res)) {
      out.set("Content-Encoding", "gzip");
      out.append("Vary", "Accept-Encoding");
      return new Response(res.body.pipeThrough(new CompressionStream("gzip")), { status: res.status, statusText: res.statusText, headers: out });
    }
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
  } catch {
    return Response.json({ code: "API_UNREACHABLE", message: `API not reachable at ${apiOrigin}` }, { status: 502 });
  }
}

/** Pre-compressed variants written by build.ts, best first. */
const ENCODINGS = [
  ["br", ".br"],
  ["gzip", ".gz"],
] as const;

/**
 * Static files from dist/, with index.html as fallback for app URLs (the app uses a hash router).
 * Sends the .br / .gz copy when the browser accepts it. Hashed file names are cached forever; the rest is revalidated.
 */
async function staticFile(req: Request): Promise<Response> {
  const path = normalize(decodeURIComponent(new URL(req.url).pathname)).replace(/^(\.\.[/\\])+/, "");
  let file = Bun.file(join(dist, path));
  if (path.endsWith("/") || !(await file.exists())) {
    // A missing script, style or font (an old chunk after a deploy…) is a 404, never the HTML page under its name.
    if (/\.\w+$/.test(path)) return new Response("Not found", { status: 404, headers: SECURITY_HEADERS });
    file = Bun.file(join(dist, "index.html"));
  }
  const immutable = /-[a-z0-9]{8}\.\w+$/i.test(file.name ?? "");
  const headers: Record<string, string> = {
    ...SECURITY_HEADERS,
    "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache",
    Vary: "Accept-Encoding",
  };
  const accepted = req.headers.get("accept-encoding") ?? "";
  for (const [encoding, ext] of ENCODINGS) {
    if (!accepted.includes(encoding)) continue;
    const compressed = Bun.file(file.name + ext);
    if (await compressed.exists()) {
      return new Response(compressed, { headers: { ...headers, "Content-Encoding": encoding, "Content-Type": file.type } });
    }
  }
  return new Response(file, { headers });
}

/** Dev only: /fonts/* straight from node_modules (production serves the copies in dist/fonts). */
function devFonts(): (req: Request) => Response {
  const { css, files } = fontAssets();
  return (req) => {
    const name = new URL(req.url).pathname.slice("/fonts/".length);
    if (name === "fonts.css") return new Response(css, { headers: { "Content-Type": "text/css; charset=utf-8" } });
    const path = files.get(name);
    return path ? new Response(Bun.file(path)) : new Response("Not found", { status: 404 });
  };
}

if (production && !existsSync(join(dist, "index.html"))) await buildBackoffice(dist);

const server = Bun.serve({
  port,
  hostname: process.env.WEB_HOST ?? "0.0.0.0",
  maxRequestBodySize: 12 * 1024 * 1024,
  development: production ? false : { hmr: true, console: true },
  routes: { "/rpc/*": proxy, "/webhooks/*": proxy, "/fonts/*": production ? staticFile : devFonts(), "/*": production ? staticFile : index },
  fetch: staticFile,
});

console.log(`back-office ${production ? "(production)" : "(dev, hot reload)"} on ${server.url} → API ${apiOrigin}`);

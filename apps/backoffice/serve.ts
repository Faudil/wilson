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
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: out });
  } catch {
    return Response.json({ code: "API_UNREACHABLE", message: `API not reachable at ${apiOrigin}` }, { status: 502 });
  }
}

/** Static files from dist/, with index.html as fallback (the app uses a hash router). */
async function staticFile(req: Request): Promise<Response> {
  const path = normalize(decodeURIComponent(new URL(req.url).pathname)).replace(/^(\.\.[/\\])+/, "");
  let file = Bun.file(join(dist, path));
  if (path.endsWith("/") || !(await file.exists())) file = Bun.file(join(dist, "index.html"));
  const immutable = /-[a-z0-9]{8}\.\w+$/i.test(path);
  return new Response(file, {
    headers: { ...SECURITY_HEADERS, "Cache-Control": immutable ? "public, max-age=31536000, immutable" : "no-cache" },
  });
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

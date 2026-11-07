import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { RPCHandler } from "@orpc/server/node";
import { BodyLimitPlugin } from "@orpc/server/node";
import { CORSPlugin } from "@orpc/server/plugins";
import type { WaDeps } from "./whatsapp/context.js";
import { handleWhatsAppWebhook } from "./whatsapp/webhook.js";
import { createContext } from "./rpc/context.js";
import { router } from "./rpc/router.js";
import type { RpcContext } from "./rpc/base.js";

export const SESSION_COOKIE = "wilson_session";
const MAX_BODY_BYTES = 12 * 1024 * 1024;

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function sessionCookie(token: string | null, expires: Date | undefined, secure: boolean): string {
  const attrs = ["Path=/", "HttpOnly", "SameSite=Strict"];
  if (secure) attrs.push("Secure");
  if (token === null) return [`${SESSION_COOKIE}=`, ...attrs, "Max-Age=0", "Expires=Thu, 01 Jan 1970 00:00:00 GMT"].join("; ");
  if (expires) attrs.push(`Expires=${expires.toUTCString()}`);
  return [`${SESSION_COOKIE}=${encodeURIComponent(token)}`, ...attrs].join("; ");
}

export function createHttpServer(deps: WaDeps): Server {
  const secure = deps.config.NODE_ENV === "production";
  const rpc = new RPCHandler<RpcContext>(router, {
    plugins: [
      new CORSPlugin({ origin: deps.config.PUBLIC_BACKOFFICE_ORIGIN, credentials: true }),
      new BodyLimitPlugin({ maxBodySize: MAX_BODY_BYTES }),
    ],
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const path = (req.url ?? "/").split("?")[0]!;

    if (path === "/health" && req.method === "GET") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true }));
      return;
    }

    if (path === "/webhooks/whatsapp") {
      await handleWhatsAppWebhook(req, res, deps);
      return;
    }

    if (path.startsWith("/rpc/") || path === "/rpc") {
      const token = readCookie(req.headers.cookie, SESSION_COOKIE);
      const context = await createContext(deps, token, (t, expires) => {
        res.setHeader("Set-Cookie", sessionCookie(t, expires, secure));
      });
      const result = await rpc.handle(req, res, { prefix: "/rpc", context });
      if (result.matched) return;
    }

    res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "not_found" }));
  }

  return createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error("[http]", err);
      if (!res.headersSent) res.writeHead(500, { "content-type": "application/json" });
      if (!res.writableEnded) res.end(JSON.stringify({ error: "internal" }));
    });
  });
}

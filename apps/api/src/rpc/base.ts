import { implement, ORPCError } from "@orpc/server";
import { contract, type Permission, type Volunteer } from "@wilson/contracts";
import type { Deps } from "../deps.js";

/** Per-request context, built in server.ts from the HTTP request. */
export interface RpcContext {
  deps: Deps;
  /** Raw session cookie token (if any). */
  sessionToken: string | null;
  /** Set by the auth layer: resolved volunteer (permissions already effective). */
  volunteer: Volunteer | null;
  /** Lets procedures set/clear the session cookie (auth.login / auth.logout). */
  setSessionCookie: (token: string | null, expires?: Date) => void;
}

/** Every procedure implementation starts from `os`. */
export const os = implement(contract).$context<RpcContext>();

/** Use on every procedure but auth.login and system.health: `os.letters.list.use(requirePermission("letters.review"))`. */
export const requirePermission = (...needed: Permission[]) =>
  os.middleware(async ({ context, next }) => {
    const v = context.volunteer;
    if (!v) throw new ORPCError("UNAUTHORIZED");
    if (!needed.every((p) => v.permissions.includes(p))) throw new ORPCError("FORBIDDEN");
    return next({ context: { volunteer: v } });
  });

/** Append to access_log. Call from procedures that reveal content (photo, file) or change state. */
export type LogAccess = (ctx: RpcContext, action: string, targetId: string | null) => Promise<void>;

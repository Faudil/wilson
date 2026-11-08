import { implement, ORPCError } from "@orpc/server";
import { contract, type Permission, type Volunteer } from "@wilson/contracts";
import type { Deps } from "../deps.js";
import { recordRead } from "../auth/audit.js";
import { DomainError } from "../errors.js";

/** Per-request context, built in server.ts from the HTTP request. */
export interface RpcContext {
  deps: Deps;
  /** Raw session cookie token (if any). */
  sessionToken: string | null;
  /** Set by the auth layer: resolved volunteer (permissions already effective). */
  volunteer: Volunteer | null;
  /** Visitor's IP (from X-Forwarded-For, see TRUST_PROXY_HOPS), for login and signup rate limits. Never stored. */
  ip: string | null;
  /** Lets procedures set/clear the session cookie (auth.login / auth.logout). */
  setSessionCookie: (token: string | null, expires?: Date) => void;
}

/** Every procedure implementation starts from `os`. */
export const os = implement(contract).$context<RpcContext>();

/** Does this volunteer hold the permission? (Permissions are already effective: role bundle + overrides.) */
export const can = (v: Volunteer, p: Permission): boolean => v.permissions.includes(p);
export const canAny = (v: Volunteer, ps: readonly Permission[]): boolean => ps.some((p) => can(v, p));

const gate = (allowed: (v: Volunteer) => boolean, countReads: boolean) =>
  os.middleware(async ({ context, next, path }, input) => {
    const v = context.volunteer;
    if (!v) throw new ORPCError("UNAUTHORIZED");
    if (!allowed(v)) throw new ORPCError("FORBIDDEN");
    const result = await next({ context: { volunteer: v } });
    // Counted only once the read succeeded (see auth/audit.ts).
    if (countReads) await recordRead(context.deps, v, path.join("."), input);
    return result;
  });

/** Use on every procedure but auth.login and system.health: `os.letters.list.use(requirePermission("letters.review"))`. Needs ALL of them. */
export const requirePermission = (...needed: Permission[]) => gate((v) => needed.every((p) => can(v, p)), true);

/** Global admins (volunteers.manage) or association admins (members.manage, with an association): the scope is checked per account. */
export const requireMemberAdmin = gate((v) => can(v, "volunteers.manage") || (can(v, "members.manage") && !!v.association), false);

/** At least ONE of the permissions. */
export const requireAny = (...any: Permission[]) => gate((v) => canAny(v, any), false);

/** Service errors become oRPC errors the same way everywhere: CONFLICT carries `data.reason`, all carry the message. */
export function mapDomainError(e: unknown): never {
  if (e instanceof DomainError) {
    throw new ORPCError(e.code, { message: e.message, ...(e.code === "CONFLICT" ? { data: { reason: e.reason } } : {}) });
  }
  throw e;
}

/** Run a service call and translate its DomainError. */
export async function guard<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (e) {
    return mapDomainError(e);
  }
}

/** Append to access_log. Call from procedures that reveal content (photo, file) or change state. */
export type LogAccess = (ctx: RpcContext, action: string, targetId: string | null) => Promise<void>;

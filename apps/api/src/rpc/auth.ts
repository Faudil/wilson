import { ORPCError } from "@orpc/server";
import { os, requirePermission } from "./base.js";
import { getAssociationSearch } from "../associations/search.js";
import { eq } from "drizzle-orm";
import type { VolunteerRole } from "@wilson/contracts";
import { openInvitation, SignupError } from "../auth/service.js";
import { associations } from "../db/schema.js";
import { getAuth } from "./context.js";
import { logAccess } from "./logAccess.js";

export const authRouter = {
  login: os.auth.login.handler(async ({ input, context, errors }) => {
    const res = await getAuth(context.deps).login(input.email, input.password, { totp: input.totp, ip: context.ip });
    switch (res.kind) {
      case "invalid": throw new ORPCError("UNAUTHORIZED");
      case "pending": throw new ORPCError("FORBIDDEN", { message: "pending_approval" });
      case "locked": throw errors.TOO_MANY_REQUESTS({ data: { retryAfterSeconds: res.retryAfterSeconds } });
      case "two_factor": throw errors.TWO_FACTOR_REQUIRED({ message: res.invalidCode ? "invalid_code" : "code_needed" });
    }
    context.setSessionCookie(res.token, res.expires);
    return res.volunteer;
  }),

  signup: os.auth.signup.handler(async ({ input, context, errors }) => {
    // Public sign-up can be off; an invite link still works (checked in the service).
    if (context.deps.config.VOLUNTEER_SIGNUP !== "on" && !input.invitationToken) throw new ORPCError("FORBIDDEN");
    try {
      await getAuth(context.deps).signup(input, { ip: context.ip });
    } catch (e) {
      if (e instanceof SignupError && e.reason === "rate_limited") throw errors.TOO_MANY_REQUESTS({ data: { retryAfterSeconds: e.retryAfterSeconds } });
      if (e instanceof SignupError && e.reason === "signup_closed") throw new ORPCError("FORBIDDEN");
      if (e instanceof SignupError) throw new ORPCError("CONFLICT", { data: { reason: e.reason } });
      throw e;
    }
    return { ok: true as const };
  }),

  verifyEmail: os.auth.verifyEmail.handler(async ({ input, context }) => {
    await getAuth(context.deps).verifyEmail(input.token);
    return { ok: true as const };
  }),
  resetPassword: os.auth.resetPassword.handler(async ({ input, context }) => {
    if (!(await getAuth(context.deps).resetPassword(input.token, input.password))) throw new ORPCError("NOT_FOUND");
    return { ok: true as const };
  }),

  finishWelcome: os.auth.finishWelcome.use(requirePermission()).handler(({ context }) => getAuth(context.deps).finishWelcome(context.volunteer.id)),

  searchAssociations: os.auth.searchAssociations.handler(({ input, context }) =>
    context.deps.config.VOLUNTEER_SIGNUP === "on" || context.volunteer ? getAssociationSearch(context.deps).search(input.query) : []),

  invitation: os.auth.invitation.handler(async ({ input, context }) => {
    const inv = await openInvitation(context.deps.db, input.token, context.deps.now());
    if (!inv) return { valid: false, associationName: null, role: null };
    const [a] = inv.associationId
      ? await context.deps.db.select({ name: associations.name }).from(associations).where(eq(associations.id, inv.associationId)).limit(1)
      : [];
    return { valid: true, associationName: a?.name ?? null, role: inv.role as VolunteerRole };
  }),

  logout: os.auth.logout.handler(async ({ context }) => {
    if (context.sessionToken) await getAuth(context.deps).logout(context.sessionToken);
    context.setSessionCookie(null);
  }),

  me: os.auth.me.use(requirePermission()).handler(({ context }) => context.volunteer),

  setUiLanguage: os.auth.setUiLanguage
    .use(requirePermission())
    .handler(({ input, context }) => getAuth(context.deps).setUiLanguage(context.volunteer.id, input.language)),

  twoFactorSetup: os.auth.twoFactorSetup.use(requirePermission()).handler(async ({ context }) => {
    const r = await getAuth(context.deps).twoFactorSetup(context.volunteer.id);
    if (!r) throw new ORPCError("CONFLICT", { data: { reason: "already_enabled" } });
    return r;
  }),

  twoFactorEnable: os.auth.twoFactorEnable.use(requirePermission()).handler(async ({ input, context }) => {
    const v = await getAuth(context.deps).twoFactorEnable(context.volunteer.id, input.code);
    if (!v) throw new ORPCError("CONFLICT", { data: { reason: "invalid_code" } });
    await logAccess(context, "auth.2fa_enable", context.volunteer.id);
    return v;
  }),

  twoFactorDisable: os.auth.twoFactorDisable.use(requirePermission()).handler(async ({ input, context }) => {
    const v = await getAuth(context.deps).twoFactorDisable(context.volunteer.id, input.code);
    if (!v) throw new ORPCError("CONFLICT", { data: { reason: "invalid_code" } });
    await logAccess(context, "auth.2fa_disable", context.volunteer.id);
    return v;
  }),
};

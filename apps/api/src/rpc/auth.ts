import { ORPCError } from "@orpc/server";
import { os, requirePermission } from "./base.js";
import { SignupError } from "../auth/service.js";
import { getAuth } from "./context.js";

export const authRouter = {
  login: os.auth.login.handler(async ({ input, context }) => {
    const res = await getAuth(context.deps).login(input.email, input.password);
    if (!res) throw new ORPCError("UNAUTHORIZED");
    if (res === "pending") throw new ORPCError("FORBIDDEN", { message: "pending_approval" });
    context.setSessionCookie(res.token, res.expires);
    return res.volunteer;
  }),

  signup: os.auth.signup.handler(async ({ input, context }) => {
    if (context.deps.config.VOLUNTEER_SIGNUP !== "on") throw new ORPCError("FORBIDDEN");
    try {
      await getAuth(context.deps).signup(input);
    } catch (e) {
      if (e instanceof SignupError) throw new ORPCError("CONFLICT", { data: { reason: e.reason } });
      throw e;
    }
    return { ok: true as const };
  }),

  logout: os.auth.logout.handler(async ({ context }) => {
    if (context.sessionToken) await getAuth(context.deps).logout(context.sessionToken);
    context.setSessionCookie(null);
  }),

  me: os.auth.me.use(requirePermission()).handler(({ context }) => context.volunteer),

  setUiLanguage: os.auth.setUiLanguage
    .use(requirePermission())
    .handler(({ input, context }) => getAuth(context.deps).setUiLanguage(context.volunteer.id, input.language)),
};

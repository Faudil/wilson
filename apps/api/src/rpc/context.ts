import type { Deps } from "../deps.js";
import { createAuthService } from "../auth/service.js";
import type { RpcContext } from "./base.js";
import { getWebAccounts } from "../webAccounts/service.js";

const authCache = new WeakMap<object, ReturnType<typeof createAuthService>>();
export function getAuth(deps: Deps) {
  let a = authCache.get(deps);
  if (!a) authCache.set(deps, (a = createAuthService(deps)));
  return a;
}

/** Builds the per-request oRPC context: resolves the session token to a volunteer (with effective permissions). */
export async function createContext(
  deps: Deps,
  sessionToken: string | null,
  setSessionCookie: RpcContext["setSessionCookie"],
  ip: string | null = null,
  me: { token: string | null; set: RpcContext["setBeneficiaryCookie"] } = { token: null, set: () => undefined },
): Promise<RpcContext> {
  const volunteer = sessionToken ? await getAuth(deps).resolveVolunteer(sessionToken) : null;
  const session = me.token ? await getWebAccounts(deps).resolve(me.token) : null;
  const beneficiary = session && me.token ? { id: session.beneficiaryId, sharedDevice: session.sharedDevice, token: me.token } : null;
  return { deps, sessionToken, volunteer, setSessionCookie, ip, beneficiary, setBeneficiaryCookie: me.set };
}

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ContractRouterClient } from "@orpc/contract";
import { createTanstackQueryUtils } from "@orpc/tanstack-query";
import type { contract } from "@wilson/contracts";

const link = new RPCLink({
  url: `${location.origin}/rpc`,
  fetch: (request, init) => globalThis.fetch(request, { ...init, credentials: "include" }),
});

export const client: ContractRouterClient<typeof contract> = createORPCClient(link);
export const orpc = createTanstackQueryUtils(client);

/** Error code of an oRPC error (UNAUTHORIZED, FORBIDDEN, NOT_FOUND, CONFLICT…), if any. */
export function errorCode(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error && typeof (error as { code: unknown }).code === "string") {
    return (error as { code: string }).code;
  }
  return null;
}

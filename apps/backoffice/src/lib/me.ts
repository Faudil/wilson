import { client, errorCode } from "./api";

export const ME_KEY = ["auth", "me"] as const;

/** Current volunteer, or null when not logged in. Other errors (network…) propagate. */
export async function fetchMe() {
  try {
    return await client.auth.me();
  } catch (error) {
    if (errorCode(error) === "UNAUTHORIZED") return null;
    throw error;
  }
}

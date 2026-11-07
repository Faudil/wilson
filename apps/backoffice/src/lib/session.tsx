import type { Permission, Volunteer } from "@wilson/contracts";
import { createContext, useContext } from "react";

export type Session = { volunteer: Volunteer; can: (permission: Permission) => boolean };
export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession outside session");
  return s;
}

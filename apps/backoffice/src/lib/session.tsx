import type { Permission, Volunteer } from "@wilson/contracts";
import { createContext, useContext } from "react";

export type Session = { volunteer: Volunteer; can: (permission: Permission) => boolean };
export const SessionContext = createContext<Session | null>(null);

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error("useSession outside session");
  return s;
}

/** Global admins manage every account; association admins (members.manage) only their own association's members. */
export const canManageMembers = (s: Session): boolean => s.can("volunteers.manage") || (s.can("members.manage") && !!s.volunteer.association);

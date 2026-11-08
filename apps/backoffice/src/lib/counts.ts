import { useQuery } from "@tanstack/react-query";
import { orpc } from "./api";

/** Letters waiting for review, and how many of them are very urgent. */
export function useLetterStats(enabled: boolean) {
  const q = useQuery({
    ...orpc.letters.list.queryOptions({ input: { status: ["pending_review"], limit: 100 } }),
    enabled,
    refetchInterval: 30_000,
    retry: false,
  });
  const items = q.data?.items ?? [];
  return { query: q, pending: items.length, urgent: items.filter((l) => l.urgency === "high").length };
}

/** Documents expiring within the next 7 days. */
export function useWeekDeadlines(enabled: boolean) {
  const q = useQuery({
    ...orpc.documents.deadlines.queryOptions({ input: { withinDays: 7 } }),
    enabled,
    refetchInterval: 60_000,
    retry: false,
  });
  return { query: q, count: q.data?.length ?? 0 };
}

/** Conversations that need a person (urgent, legal question, asked for a human). */
export function useAttentionCount(enabled: boolean): number {
  const q = useQuery({
    ...orpc.conversations.attentionCount.queryOptions(),
    enabled,
    refetchInterval: 30_000,
    retry: false,
  });
  return q.data?.count ?? 0;
}

/** My follow-up tasks due today or earlier (the reminder). */
export function useDueTasks(enabled: boolean): number {
  const q = useQuery({ ...orpc.tasks.dueCount.queryOptions(), enabled, refetchInterval: 5 * 60_000, retry: false });
  return q.data?.count ?? 0;
}

/** Volunteer sign-ups waiting for an admin. */
export function usePendingVolunteers(enabled: boolean): number {
  const q = useQuery({ ...orpc.volunteers.list.queryOptions({ input: { status: "pending" } }), enabled, refetchInterval: 60_000, retry: false });
  return q.data?.length ?? 0;
}

/** Rendez-vous waiting for a volunteer, and mine in the next 7 days. */
export function useAppointmentCounts(enabled: boolean): { open: number; mineSoon: number } {
  const q = useQuery({ ...orpc.appointments.counts.queryOptions(), enabled, refetchInterval: 60_000, retry: false });
  return q.data ?? { open: 0, mineSoon: 0 };
}

/** WhatsApp numbers held by the flood guard, waiting for a volunteer's decision. */
export function useHeldNumbers(enabled: boolean): number {
  const q = useQuery({ ...orpc.numbers.heldCount.queryOptions(), enabled, refetchInterval: 60_000, retry: false });
  return q.data?.count ?? 0;
}

/** Team news the volunteer has not opened yet (Home card and the More badge). */
export function useNewsUnread(enabled: boolean) {
  const q = useQuery({ ...orpc.news.unread.queryOptions(), enabled, refetchInterval: 5 * 60_000, retry: false });
  return { query: q, count: q.data?.count ?? 0, latest: q.data?.latest ?? [] };
}

/** Calls for backup from others not answered yet, and how many match my languages or skills. */
export function useBackupCounts(enabled: boolean): { open: number; forMe: number } {
  const q = useQuery({ ...orpc.backup.counts.queryOptions(), enabled, refetchInterval: 5 * 60_000, retry: false });
  return q.data ?? { open: 0, forMe: 0 };
}

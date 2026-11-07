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

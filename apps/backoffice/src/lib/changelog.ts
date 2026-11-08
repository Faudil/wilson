import type { Permission } from "@wilson/contracts";
import type { IconName } from "../components/Icon";
import type { MessageKey } from "../i18n";

/**
 * "What's new in Wilson": shown once after an update, then under More > What's new. Newest entry first. The id is the
 * release date (add a letter for a second release the same day: "2026-11-08b"); the server remembers the newest one
 * each volunteer has seen. An item with a permission is only shown to people who have it.
 */
export type ChangelogItem = { icon: IconName; title: MessageKey; body: MessageKey; to?: string; permission?: Permission };
export type ChangelogEntry = { id: string; items: ChangelogItem[] };

export const CHANGELOG: ChangelogEntry[] = [
  {
    id: "2026-11-08",
    items: [
      { icon: "megaphone", title: "whatsNew.news.title", body: "whatsNew.news.body", to: "news", permission: "news.view" },
      { icon: "hand", title: "whatsNew.backup.title", body: "whatsNew.backup.body", to: "backup", permission: "backup.view" },
      { icon: "sparkles", title: "whatsNew.page.title", body: "whatsNew.page.body" },
    ],
  },
];

export const LATEST_CHANGELOG = CHANGELOG[0]!.id;

/** Entries newer than `seen`, with only the items this volunteer can use. A never-seen account gets the latest one only. */
export function unseenEntries(seen: string | null, can: (p: Permission) => boolean): ChangelogEntry[] {
  const fresh = seen === null ? CHANGELOG.slice(0, 1) : CHANGELOG.filter((e) => e.id > seen);
  return visibleEntries(fresh, can);
}

export function visibleEntries(entries: ChangelogEntry[], can: (p: Permission) => boolean): ChangelogEntry[] {
  return entries.map((e) => ({ ...e, items: e.items.filter((i) => !i.permission || can(i.permission)) })).filter((e) => e.items.length > 0);
}

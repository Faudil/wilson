import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Empty, ErrorBox, Skeleton } from "../components/ui";
import { useI18n, type MessageKey } from "../i18n";
import { orpc } from "../lib/api";
import { TaskCard } from "./CaseFile";
import { Segmented } from "./Queue";

type Filter = "mine" | "unassigned" | "created";

/** Follow-up tasks across every person: mine (with the due ones first), nobody's yet, and those I gave to others. */
export function Tasks() {
  const { t } = useI18n();
  const [filter, setFilter] = useState<Filter>("mine");
  const [closed, setClosed] = useState(false);
  const query = useQuery({ ...orpc.tasks.list.queryOptions({ input: { filter, includeClosed: closed } }), refetchInterval: 60_000 });
  const items = query.data ?? [];
  const due = items.filter((x) => x.due).length;
  return (
    <section className="stack">
      <h1>{t("tasks.screenTitle")}</h1>
      <p className="muted">{t("tasks.intro")}</p>
      <Segmented
        label={t("tasks.filter")}
        value={filter}
        onChange={setFilter}
        options={(["mine", "unassigned", "created"] as Filter[]).map((f) => ({ value: f, label: t(`tasks.filter.${f}` as MessageKey), count: f === filter ? due : undefined }))}
      />
      <label className="check">
        <input type="checkbox" checked={closed} onChange={(e) => setClosed(e.target.checked)} />
        <span>{t("tasks.showClosed")}</span>
      </label>
      {query.isPending && <Skeleton lines={3} />}
      {query.isError && <ErrorBox error={query.error} retry={() => void query.refetch()} />}
      {query.isSuccess && items.length === 0 && <Empty art="done" sub={t("tasks.emptySub")}>{t(`tasks.empty.${filter}` as MessageKey)}</Empty>}
      <ul className="cards">
        {items.map((x) => (
          <li key={x.id}>
            <TaskCard task={x} showPerson />
          </li>
        ))}
      </ul>
    </section>
  );
}

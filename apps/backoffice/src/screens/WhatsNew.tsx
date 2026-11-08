import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Icon } from "../components/Icon";
import { Sheet } from "../components/ui";
import { useI18n } from "../i18n";
import { orpc } from "../lib/api";
import { CHANGELOG, LATEST_CHANGELOG, visibleEntries, type ChangelogEntry } from "../lib/changelog";
import { ME_KEY } from "../lib/me";
import { href } from "../lib/router";
import { useSession } from "../lib/session";
import { formatDate } from "../lib/wilson-i18n";

function Entry({ entry, onNavigate }: { entry: ChangelogEntry; onNavigate?: () => void }) {
  const { t, lang } = useI18n();
  return (
    <section className="stack-tight">
      <h2 className="section-title">{formatDate(entry.id.slice(0, 10), lang)}</h2>
      <ul className="whats-new-list">
        {entry.items.map((i) => (
          <li key={i.title} className="whats-new-item">
            <span className="more-icon" aria-hidden="true"><Icon name={i.icon} size={22} /></span>
            <span className="stack-tight grow">
              <strong>{t(i.title)}</strong>
              <span className="muted">{t(i.body)}</span>
              {i.to && <a href={href(i.to)} onClick={onNavigate} className="small">{t("whatsNew.open")}</a>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Opens by itself once after an update (App.tsx); closing it remembers the newest entry as seen. */
export function WhatsNewSheet({ entries, onClose }: { entries: ChangelogEntry[]; onClose: () => void }) {
  const { t } = useI18n();
  const qc = useQueryClient();
  const seen = useMutation({ ...orpc.auth.markChangelogSeen.mutationOptions(), onSuccess: (v) => qc.setQueryData(ME_KEY, v) });
  const close = () => {
    seen.mutate({ id: LATEST_CHANGELOG });
    onClose();
  };
  return (
    <Sheet open onClose={close} title={t("whatsNew.title")}>
      <div className="stack">
        <p className="sheet-text">{t("whatsNew.intro")}</p>
        {entries.map((e) => <Entry key={e.id} entry={e} onNavigate={close} />)}
        <button type="button" className="btn btn-block btn-primary" onClick={close}>{t("whatsNew.ok")}</button>
      </div>
    </Sheet>
  );
}

/** More > What's new: every entry. */
export function WhatsNew() {
  const { t } = useI18n();
  const { can } = useSession();
  return (
    <section className="stack-lg">
      <h1>{t("whatsNew.title")}</h1>
      {visibleEntries(CHANGELOG, can).map((e) => <div key={e.id} className="card"><Entry entry={e} /></div>)}
    </section>
  );
}

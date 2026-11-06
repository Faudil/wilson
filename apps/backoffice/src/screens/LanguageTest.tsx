import { LANGUAGE_CODES, LANGUAGES, type LanguageCode } from "@wilson/contracts";
import { useI18n } from "../i18n";
import { SAMPLES, TEST_ADDRESS, TEST_DATE, TEST_REFERENCE } from "../lib/samples";
import { formatDate } from "../lib/wilson-i18n";

/** Static page: needs no backend, so fonts and RTL can be checked on any device before a release. */
export function LanguageTest() {
  const { t } = useI18n();
  return (
    <section className="stack">
      <h1>{t("langtest.title")}</h1>
      <p className="muted">{t("langtest.intro")}</p>
      <ul className="cards">
        {LANGUAGE_CODES.map((code) => (
          <li key={code}>
            <LanguageCard code={code} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function LanguageCard({ code }: { code: LanguageCode }) {
  const { t } = useI18n();
  const l = LANGUAGES[code];
  const s = SAMPLES[code];
  return (
    <article className="card langcard" data-lang={code}>
      <header className="row wrap between">
        <strong lang={code} dir={l.dir} className="card-title">
          {l.nativeName}
        </strong>
        <span className="muted small" dir="ltr">
          {code} · {l.dir} · {s.font}
        </span>
      </header>
      <div className="sample-block">
        <p className="long-text sample" lang={code} dir={l.dir}>
          {s.sentence}
        </p>
      </div>
      <div className="sample-block">
        <div className="muted small">{t("langtest.date")}</div>
        <p className="sample" lang={code} dir={l.dir}>
          {formatDate(TEST_DATE, code, { weekday: true })}
        </p>
      </div>
      <div className="sample-block mixed">
        <div className="muted small">{t("langtest.mixed")}</div>
        <p className="sample" lang={code} dir={l.dir}>
          {s.addressLabel}: <bdi>{TEST_ADDRESS}</bdi> — {s.referenceLabel}: <bdi>{TEST_REFERENCE}</bdi>
        </p>
      </div>
      {s.special && (
        <p className="sample letters" lang={code} dir={l.dir}>
          {[...s.special].join(" ")}
        </p>
      )}
    </article>
  );
}

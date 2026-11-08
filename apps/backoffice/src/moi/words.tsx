import { useMemo, useState } from "react";
import { RECOVERY_WORD_COUNT, RECOVERY_WORDS, normaliseRecoveryWord } from "@wilson/contracts/values";
import { useT } from "./i18n";

const PICTURE = new Map<string, string>(RECOVERY_WORDS.map(([w, p]) => [w, p]));
export const pictureOf = (w: string): string => PICTURE.get(w) ?? "❔";

/** The 6 words as numbered cards: picture first (readable by everyone), then the word. */
export function WordCards({ words }: { words: readonly string[] }) {
  return (
    <ol className="moi-words" dir="ltr">
      {words.map((w, i) => (
        <li key={i} className="moi-word">
          <span className="moi-word-n">{i + 1}</span>
          <span className="moi-word-pic" aria-hidden="true">{pictureOf(w)}</span>
          <span className="moi-word-text" lang="fr">{w}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Entering the words: type them (suggestions after 1 letter, a 4-letter prefix is always unique) or tap the pictures.
 * The person sees the 6 slots fill in order and can take the last one back.
 */
export function WordPicker({ value, onChange }: { value: string[]; onChange: (w: string[]) => void }) {
  const { t } = useT();
  const [typed, setTyped] = useState("");
  const q = normaliseRecoveryWord(typed);
  const suggestions = useMemo(() => (q ? RECOVERY_WORDS.filter(([w]) => w.startsWith(q)).slice(0, 6) : []), [q]);
  const full = value.length >= RECOVERY_WORD_COUNT;
  const add = (w: string) => {
    if (full) return;
    onChange([...value, w]);
    setTyped("");
  };

  return (
    <div className="moi-picker">
      <ol className="moi-slots" dir="ltr" aria-live="polite">
        {Array.from({ length: RECOVERY_WORD_COUNT }, (_, i) => (
          <li key={i} className={`moi-slot ${value[i] ? "moi-slot-filled" : ""} ${i === value.length ? "moi-slot-next" : ""}`}>
            <span className="moi-word-n">{i + 1}</span>
            {value[i] ? (
              <>
                <span className="moi-word-pic" aria-hidden="true">{pictureOf(value[i]!)}</span>
                <span className="moi-word-text" lang="fr">{value[i]}</span>
              </>
            ) : null}
          </li>
        ))}
      </ol>
      <div className="moi-picker-row">
        <input
          className="moi-input"
          dir="ltr"
          lang="fr"
          value={typed}
          disabled={full}
          autoCapitalize="none"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          inputMode="text"
          aria-label={t("login_hint")}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && suggestions[0]) {
              e.preventDefault();
              add(suggestions[0][0]);
            }
            if (e.key === "Backspace" && !typed && value.length) onChange(value.slice(0, -1));
          }}
        />
        <button type="button" className="btn" disabled={!value.length} onClick={() => onChange(value.slice(0, -1))}>
          ⌫ <span className="visually-hidden">{t("clear")}</span>
        </button>
      </div>
      {suggestions.length > 0 && (
        <div className="moi-suggest" dir="ltr">
          {suggestions.map(([w, p]) => (
            <button key={w} type="button" className="moi-chip" onClick={() => add(w)}>
              <span aria-hidden="true">{p}</span> <span lang="fr">{w}</span>
            </button>
          ))}
        </div>
      )}
      <div className="moi-grid" dir="ltr">
        {RECOVERY_WORDS.map(([w, p]) => (
          <button key={w} type="button" className="moi-grid-cell" disabled={full} onClick={() => add(w)} title={w} aria-label={w}>
            <span aria-hidden="true">{p}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

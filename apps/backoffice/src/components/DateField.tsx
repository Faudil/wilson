import { useId } from "react";
import { useI18n, type MessageKey } from "../i18n";
import { formatDate } from "../lib/wilson-i18n";

/** Native date input with the written-out date beside it, to avoid DD/MM confusion. */
export function DateField({
  label,
  value,
  onChange,
  previewKey,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (iso: string) => void;
  previewKey: MessageKey;
  disabled?: boolean;
}) {
  const { t, lang } = useI18n();
  const id = useId();
  const valid = /^\d{4}-\d{2}-\d{2}$/.test(value);
  let preview = "";
  if (valid) {
    try {
      preview = formatDate(value, lang, { weekday: true });
    } catch {
      preview = "";
    }
  }
  return (
    <div className="field">
      <label htmlFor={id}>
        <span className="field-label">{label}</span>
      </label>
      <input id={id} type="date" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} dir="ltr" />
      {preview ? <strong className="date-preview" aria-live="polite">{t(previewKey, { date: preview })}</strong> : null}
    </div>
  );
}

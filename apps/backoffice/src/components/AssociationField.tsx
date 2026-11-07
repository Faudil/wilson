import type { AssociationRef } from "@wilson/contracts";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";
import { useI18n } from "../i18n";
import { orpc } from "../lib/api";
import { Icon } from "./Icon";

/** Value typed by the user without picking a suggestion: kept as free text (no SIREN/RNA). */
export const freeText = (name: string): AssociationRef | null => (name.trim().length >= 2 ? { name: name.trim(), siren: null, rna: null, city: null } : null);

/**
 * Lightweight combobox (no library): debounced server-side search in the official association register,
 * keyboard + touch friendly, free text always allowed.
 */
export function AssociationField({
  value,
  onChange,
  label,
  optional = true,
}: {
  value: AssociationRef | null;
  onChange: (v: AssociationRef | null) => void;
  label?: string;
  optional?: boolean;
}) {
  const { t } = useI18n();
  const id = useId();
  const [text, setText] = useState(value?.name ?? "");
  const [debounced, setDebounced] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const picked = !!value?.siren || !!value?.rna;

  useEffect(() => {
    const h = setTimeout(() => setDebounced(text.trim()), 350);
    return () => clearTimeout(h);
  }, [text]);

  const enabled = open && !picked && debounced.length >= 3;
  const q = useQuery({
    ...orpc.auth.searchAssociations.queryOptions({ input: { query: debounced } }),
    enabled,
    staleTime: 10 * 60_000,
    retry: false,
  });
  const items = enabled ? (q.data ?? []) : [];
  const listId = `${id}-list`;

  const choose = (a: AssociationRef) => {
    onChange(a);
    setText(a.name);
    setOpen(false);
    setActive(-1);
  };

  return (
    <div className="field assoc-field">
      <label className="field-label" htmlFor={id}>
        {label ?? t("signup.association")} {optional && <span className="muted small">({t("common.optional")})</span>}
      </label>
      <div className="assoc-box">
        <input
          id={id}
          role="combobox"
          aria-expanded={items.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          maxLength={200}
          placeholder={t("signup.associationPlaceholder")}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setActive(-1);
            onChange(freeText(e.target.value));
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (!items.length) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((i) => (i + 1) % items.length);
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((i) => (i <= 0 ? items.length - 1 : i - 1));
            } else if (e.key === "Enter" && active >= 0) {
              e.preventDefault();
              choose(items[active]!);
            } else if (e.key === "Escape") {
              setOpen(false);
            }
          }}
        />
        {items.length > 0 && (
          <ul id={listId} role="listbox" className="assoc-list">
            {items.map((a, i) => (
              <li
                key={`${a.siren ?? a.rna ?? a.name}-${i}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={i === active ? "is-active" : ""}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(a)}
              >
                <strong>{a.name}</strong>
                {a.city && <span className="muted small">{a.city}</span>}
              </li>
            ))}
          </ul>
        )}
      </div>
      <span className="muted small assoc-hint" aria-live="polite">
        {picked ? (
          <>
            <Icon name="checkCircle" size={14} /> {t("signup.associationVerified")}
            {value?.city ? ` · ${value.city}` : ""}
          </>
        ) : enabled && q.isFetching ? (
          t("common.loading")
        ) : enabled && q.isSuccess && items.length === 0 ? (
          t("signup.associationNotFound")
        ) : (
          t("signup.associationHint")
        )}
      </span>
    </div>
  );
}

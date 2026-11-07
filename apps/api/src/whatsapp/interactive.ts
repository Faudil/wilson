/**
 * Tap-able WhatsApp messages built from our numbered-menu texts.
 *
 * Every menu in the catalogs is written "1 - Label" one per line, so the same text works as a typed menu (numbers
 * always keep working) and as WhatsApp reply buttons or a list: the option lines become the buttons/rows, the other
 * lines the message body, and each button's id is the number the person would have typed.
 * Meta limits: reply buttons ≤ 3 with titles ≤ 20 characters; list rows ≤ 10 with titles ≤ 24 and descriptions ≤ 72;
 * list button ≤ 20; body ≤ 1024. Anything that does not fit stays a plain text message.
 */
export interface Choice {
  /** What the person would type: "1", "0", "9"… */
  id: string;
  title: string;
  description?: string;
}
export type Interactive = { kind: "buttons" | "list"; body: string; choices: Choice[]; listButton: string };

const OPTION = /^[‎‏\s]*(\d{1,2})\s*-\s*(.+?)\s*$/;
const MARKS = /[‎‏⁦-⁩]/g;
const cut = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

/** Parse "1 - Label" option lines out of a menu text; null when it is not a menu WhatsApp can show as one. */
export function toInteractive(text: string): Interactive | null {
  const options: { id: string; label: string }[] = [];
  const rest: string[] = [];
  for (const line of text.split("\n")) {
    const m = OPTION.exec(line);
    if (m) options.push({ id: m[1]!, label: m[2]!.replace(MARKS, "").trim() });
    else rest.push(line);
  }
  const body = rest.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (options.length < 2 || options.length > 10 || !body || body.length > 1024) return null;
  if (new Set(options.map((o) => o.id)).size !== options.length) return null;
  // WhatsApp caps the list button at 20 characters: with 10 options, drop the space so every number still shows.
  const ids = options.map((o) => o.id).join("·");
  const listButton = cut(ids.length + 2 <= 20 ? `☰ ${ids}` : `☰${ids}`, 20);
  if (options.length <= 3 && options.every((o) => o.label.length <= 20)) {
    return { kind: "buttons", body, listButton, choices: options.map((o) => ({ id: o.id, title: o.label })) };
  }
  return {
    kind: "list", body, listButton,
    choices: options.map((o) => ({ id: o.id, title: cut(o.label, 24), ...(o.label.length > 24 ? { description: cut(o.label, 72) } : {}) })),
  };
}

/** Tiny tolerant XML parser (no DTD, no validation) — enough for the DILA "Publication" documents. */
export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: (XmlElement | string)[];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", laquo: "«", raquo: "»", hellip: "…", rsquo: "’", lsquo: "‘", ndash: "–", mdash: "—", euro: "€" };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try {
        return String.fromCodePoint(code);
      } catch {
        return "";
      }
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function parseXml(xml: string): XmlElement {
  const root: XmlElement = { name: "#root", attrs: {}, children: [] };
  const stack: XmlElement[] = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*(?:\[[\s\S]*?\])?>|<\/\s*([^\s>]+)\s*>|<([^\s/>!?]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const top = stack[stack.length - 1]!;
    if (m[1] !== undefined) top.children.push(m[1]);
    else if (m[2] !== undefined) {
      // Tolerate mismatches: pop up to the matching open element if there is one.
      const i = stack.map((e) => e.name).lastIndexOf(m[2]);
      if (i > 0) stack.length = i;
    } else if (m[3] !== undefined) {
      const el: XmlElement = { name: m[3], attrs: {}, children: [] };
      for (const a of (m[4] ?? "").matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) el.attrs[a[1]!] = decodeEntities(a[2] ?? a[3] ?? "");
      top.children.push(el);
      if (!m[5]) stack.push(el);
    } else if (m[6] !== undefined) top.children.push(decodeEntities(m[6]));
  }
  const first = root.children.find((c): c is XmlElement => typeof c !== "string");
  if (!first) throw new Error("empty XML document");
  return first;
}

/** Name without namespace prefix. */
export const localName = (el: XmlElement): string => el.name.replace(/^.*:/, "");

export const childElements = (el: XmlElement, name?: string): XmlElement[] =>
  el.children.filter((c): c is XmlElement => typeof c !== "string" && (name === undefined || localName(c) === name));

/** All descendants (depth-first) with this local name. */
export function descendants(el: XmlElement, name: string, out: XmlElement[] = []): XmlElement[] {
  for (const c of childElements(el)) {
    if (localName(c) === name) out.push(c);
    descendants(c, name, out);
  }
  return out;
}

const BLOCKS = new Set(["Paragraphe", "Titre", "Item", "Cas", "Situation", "Chapitre", "SousChapitre", "Liste", "Tableau", "Ligne", "Rangée", "Introduction", "Texte", "Adresse", "Ligne", "Note", "Attention", "ASavoir", "Rappel", "Exemple", "Avertissement", "SousTitre", "Cellule", "TitreCas", "OuSAdresser", "Etape", "Etapes", "Description", "br"]);

/** Plain text of an element: block elements are separated by newlines, list items prefixed with "- ". */
export function textOf(el: XmlElement | string): string {
  const parts: string[] = [];
  const walk = (n: XmlElement | string): void => {
    if (typeof n === "string") {
      parts.push(n.replace(/\s+/g, " "));
      return;
    }
    const name = localName(n);
    const block = BLOCKS.has(name);
    if (block) parts.push("\n");
    if (name === "Item") parts.push("- ");
    for (const c of n.children) walk(c);
    if (block) parts.push("\n");
  };
  walk(el);
  return parts
    .join("")
    .replace(/(^|\n)- (?:\s*\n)+/g, "$1- ")
    .split("\n")
    .map((l) => l.replace(/[ \t ]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

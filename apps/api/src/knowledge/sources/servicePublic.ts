import { MAX_CHUNK_CHARS, splitText } from "../chunking.js";
import type { KnowledgeChunkInput, SourceAdapter } from "../types.js";
import { childElements, descendants, localName, parseXml, textOf, type XmlElement } from "../xml.js";
import { readZip } from "../zip.js";
import { isRelevant } from "./servicePublicTopics.js";

export const SERVICE_PUBLIC_ZIP_URL = "https://www.data.gouv.fr/api/1/datasets/r/d1b0f744-c997-48d2-9ec4-1c64e82202d6";
const FICHE_URL = "https://www.service-public.fr/particuliers/vosdroits/";

export interface Fiche {
  id: string;
  title: string;
  updatedAt: Date | null;
  sections: { title: string; text: string }[];
  relevant: boolean;
}

const firstText = (el: XmlElement, name: string): string => {
  const e = descendants(el, name)[0];
  return e ? textOf(e).replace(/\s+/g, " ").trim() : "";
};

/** Parses one DILA "Publication" XML document. Returns null for things that are not fiches (themes, resources). */
export function parseFiche(xml: string): Fiche | null {
  const root = parseXml(xml);
  if (localName(root) !== "Publication") return null;
  const id = root.attrs.ID ?? firstText(root, "identifier");
  const type = root.attrs.type ?? "";
  if (!/^F\d+/.test(id) || (type && !/^Fiche/i.test(type))) return null;
  const title = firstText(root, "title") || firstText(root, "Titre");
  if (!title) return null;
  const audience = firstText(root, "Audience");
  if (audience && !/particuliers/i.test(audience)) return null;

  const date = firstText(root, "date").slice(0, 10);
  const updatedAt = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00Z`) : null;

  const sections: { title: string; text: string }[] = [];
  const add = (t: string, el: XmlElement | string, skipTitle = true): void => {
    let text = typeof el === "string" ? el : textOf(el);
    const first = text.split("\n")[0];
    if (skipTitle && first && first.trim() === t.trim()) text = text.split("\n").slice(1).join("\n");
    if (text.trim()) sections.push({ title: t, text: text.trim() });
  };
  for (const top of childElements(root)) {
    const n = localName(top);
    if (n === "Introduction") add("Présentation", top);
    else if (n === "Texte") {
      const chapters = childElements(top).filter((c) => /^(Chapitre|SousChapitre)$/.test(localName(c)));
      if (chapters.length === 0) add("Détails", top);
      for (const ch of chapters) add(firstText({ ...ch, children: childElements(ch, "Titre").slice(0, 1) }, "Titre") || "Détails", ch);
    } else if (n === "ListeSituations") {
      for (const sit of childElements(top, "Situation")) add(firstText({ ...sit, children: childElements(sit, "Titre").slice(0, 1) }, "Titre") || "Selon votre situation", sit);
    } else if (n === "BlocCas") add("Selon votre situation", top);
    else if (n === "OuSAdresser") add("Où s'adresser ?", top);
    else if (n === "QuestionReponse" || n === "Reponse") add("Réponse", top);
  }
  if (sections.length === 0) {
    const desc = firstText(root, "description");
    if (desc) sections.push({ title: "Résumé", text: desc });
  }

  const themeIds = [...descendants(root, "Theme"), ...descendants(root, "SousThemePere"), ...descendants(root, "SousTheme"), ...descendants(root, "Niveau"), ...descendants(root, "FilDAriane")]
    .flatMap((e) => [e.attrs.ID ?? "", ...descendants(e, "Niveau").map((n) => n.attrs.ID ?? "")])
    .filter(Boolean);
  const breadcrumb = [...descendants(root, "Niveau"), ...descendants(root, "Theme"), ...descendants(root, "SousTheme")].map((e) => textOf(e).replace(/\s+/g, " "));
  const relevant = isRelevant({ id, title, subject: firstText(root, "subject"), breadcrumb, themeIds });
  return { id, title, updatedAt, sections, relevant };
}

export function ficheChunks(f: Fiche): KnowledgeChunkInput[] {
  const out: KnowledgeChunkInput[] = [];
  f.sections.forEach((s, si) => {
    const pieces = splitText(s.text, MAX_CHUNK_CHARS);
    pieces.forEach((text, pi) => {
      const suffix = pieces.length > 1 ? ` (${pi + 1}/${pieces.length})` : "";
      out.push({
        externalId: `${f.id}#${si}.${pi}`,
        kind: "procedure",
        title: `${f.title} — ${s.title}${suffix}`,
        url: `${FICHE_URL}${f.id}`,
        department: null,
        text,
        sourceUpdatedAt: f.updatedAt,
      });
    });
  });
  return out;
}

export const servicePublicAdapter: SourceAdapter = {
  id: "service_public",
  name: "Service-Public.fr — fiches pratiques (Particuliers)",
  license: "Licence Ouverte 2.0 (DILA)",
  homepage: "https://www.data.gouv.fr/datasets/fiches-pratiques-et-ressources-de-service-public-gouv-fr-particuliers",
  enabledByDefault: true,
  disabledReason: null,
  async *fetch({ config, fetch: doFetch, log }) {
    const url = config.SERVICE_PUBLIC_ZIP_URL ?? SERVICE_PUBLIC_ZIP_URL;
    log(`downloading ${url}`);
    const res = await doFetch(url, { redirect: "follow", signal: AbortSignal.timeout(10 * 60_000) });
    if (!res.ok) throw new Error(`Service-Public: téléchargement impossible (HTTP ${res.status})`);
    const entries = readZip(Buffer.from(await res.arrayBuffer()));
    let scanned = 0;
    let kept = 0;
    let chunks = 0;
    for (const e of entries) {
      if (!/(^|\/)F\d+\.xml$/i.test(e.name)) continue;
      scanned++;
      let fiche: Fiche | null;
      try {
        fiche = parseFiche(e.read().toString("utf8"));
      } catch (err) {
        log(`skip ${e.name}: ${(err as Error).message}`);
        continue;
      }
      if (!fiche || !fiche.relevant) continue;
      kept++;
      for (const c of ficheChunks(fiche)) {
        chunks++;
        yield c;
      }
    }
    log(`${scanned} fiches read, ${kept} kept, ${chunks} chunks`);
    if (chunks === 0) throw new Error("Service-Public: aucune fiche pertinente trouvée dans l'archive (format changé ?)");
  },
};

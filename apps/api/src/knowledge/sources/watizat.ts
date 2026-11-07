import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { splitText } from "../chunking.js";
import { resolveKnowledgeDir } from "../files.js";
import { extractPdfText } from "../pdf.js";
import type { KnowledgeChunkInput, SourceAdapter } from "../types.js";

/** City in the file name (watizat-paris.pdf, Guide Watizat Lyon 2024.pdf…) → INSEE département. */
export const CITY_DEPARTMENTS: Record<string, string> = {
  paris: "75", lyon: "69", marseille: "13", toulouse: "31", bordeaux: "33", strasbourg: "67", lille: "59", nantes: "44",
};

export function departmentFromFilename(name: string): string | null {
  const n = name.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  for (const [city, dept] of Object.entries(CITY_DEPARTMENTS)) if (n.includes(city)) return dept;
  return null;
}

const looksLikeHeading = (l: string): boolean => {
  const t = l.trim();
  if (t.length < 4 || t.length > 70 || /[.,;:!?]$/.test(t)) return false;
  const letters = t.replace(/[^\p{L}]/gu, "");
  if (letters.length < 3) return false;
  const upper = letters.replace(/[^\p{Lu}]/gu, "").length / letters.length;
  return upper > 0.8 || /^\d{1,2}[.)]\s+\p{Lu}/u.test(t);
};

/** Splits extracted text into chunks: new chunk at each detected heading, or every ~1200 characters. */
export function guideChunks(fileId: string, guideTitle: string, text: string, department: string | null): KnowledgeChunkInput[] {
  const sections: { title: string; lines: string[] }[] = [{ title: "", lines: [] }];
  for (const line of text.split("\n")) {
    if (looksLikeHeading(line)) sections.push({ title: line.trim(), lines: [] });
    else if (line.trim()) sections[sections.length - 1]!.lines.push(line.trim());
  }
  const out: KnowledgeChunkInput[] = [];
  let n = 0;
  for (const s of sections) {
    for (const piece of splitText(s.lines.join("\n"), 1200)) {
      if (piece.length < 40) continue;
      n++;
      out.push({
        externalId: `${fileId}#${n}`,
        kind: "guide",
        title: s.title ? `${guideTitle} — ${s.title}` : `${guideTitle} — extrait ${n}`,
        url: null,
        department,
        text: piece,
        sourceUpdatedAt: null,
      });
    }
  }
  return out;
}

export const watizatAdapter: SourceAdapter = {
  id: "watizat",
  name: "Guides Watizat",
  license: "Tous droits réservés (Watizat)",
  homepage: "https://watizat.org/",
  enabledByDefault: false,
  disabledReason: "En attente de l'autorisation de Watizat",
  async *fetch({ config, log }) {
    const dir = join(resolveKnowledgeDir(config.KNOWLEDGE_DIR), "watizat");
    let names: string[];
    try {
      names = (await readdir(dir)).filter((n) => /\.pdf$/i.test(n)).sort();
    } catch {
      log(`watizat: dossier introuvable (${dir}) — déposez les PDF des guides dedans`);
      return;
    }
    for (const n of names) {
      const fileId = basename(n).replace(/\.pdf$/i, "");
      const text = extractPdfText(await readFile(join(dir, n)));
      if (!text.trim()) {
        log(`watizat: aucun texte extractible dans ${n} (PDF scanné ou chiffré ?)`);
        continue;
      }
      const dept = departmentFromFilename(n);
      const title = `Guide Watizat${dept ? ` ${Object.entries(CITY_DEPARTMENTS).find(([, d]) => d === dept)![0].replace(/^./, (c) => c.toUpperCase())}` : ""}`;
      yield* guideChunks(fileId, title, text, dept);
    }
  },
};

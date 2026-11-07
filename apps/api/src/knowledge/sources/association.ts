import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { splitText } from "../chunking.js";
import { parseFrontMatter, resolveKnowledgeDir } from "../files.js";
import type { KnowledgeChunkInput, SourceAdapter } from "../types.js";

const slug = (s: string): string =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "section";

/** Strips light Markdown so the text reads well in a prompt. */
const plain = (md: string): string =>
  md
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/^\s*[-*]\s+/gm, "- ")
    .replace(/^>\s?/gm, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();

export function noteToChunks(file: string, src: string): KnowledgeChunkInput[] {
  const { meta, body } = parseFrontMatter(src);
  const fileId = basename(file).replace(/\.md$/i, "");
  const noteTitle = meta.title || body.match(/^#\s+(.+)$/m)?.[1]?.trim() || fileId;
  const kind = meta.kind === "contact" || meta.kind === "procedure" ? meta.kind : "guide";
  const department = meta.department?.trim() || null;
  const url = meta.url?.trim() || null;
  const updated = meta.updated && !Number.isNaN(Date.parse(meta.updated)) ? new Date(meta.updated) : null;

  // Split on "## " headings; text before the first one (minus the "# " title) is the introduction.
  const sections: { title: string; text: string }[] = [];
  let cur = { title: "Présentation", lines: [] as string[] };
  const flush = () => {
    const text = plain(cur.lines.join("\n"));
    if (text) sections.push({ title: cur.title, text });
  };
  for (const line of body.split(/\r?\n/)) {
    const h = line.match(/^##\s+(.+?)\s*#*$/);
    if (h) {
      flush();
      cur = { title: h[1]!, lines: [] };
    } else if (!/^#\s+/.test(line)) cur.lines.push(line);
  }
  flush();

  const out: KnowledgeChunkInput[] = [];
  const used = new Set<string>();
  for (const s of sections) {
    const pieces = splitText(s.text);
    pieces.forEach((text, i) => {
      let ext = `${fileId}#${slug(s.title)}${pieces.length > 1 ? `.${i}` : ""}`;
      while (used.has(ext)) ext += "_";
      used.add(ext);
      out.push({
        externalId: ext,
        kind,
        title: `${noteTitle} — ${s.title}${pieces.length > 1 ? ` (${i + 1}/${pieces.length})` : ""}`,
        url,
        department,
        text,
        sourceUpdatedAt: updated,
      });
    });
  }
  return out;
}

export const associationAdapter: SourceAdapter = {
  id: "association",
  name: "Notes de l'association",
  license: "Contenu de l'association (usage interne)",
  homepage: "https://example.org/",
  enabledByDefault: true,
  disabledReason: null,
  async *fetch({ config, log }) {
    const dir = join(resolveKnowledgeDir(config.KNOWLEDGE_DIR), "association");
    let names: string[];
    try {
      names = (await readdir(dir)).filter((n) => /\.md$/i.test(n) && !/^readme\.md$/i.test(n)).sort();
    } catch {
      log(`association: dossier introuvable (${dir})`);
      return;
    }
    for (const n of names) {
      const path = join(dir, n);
      if (!(await stat(path)).isFile()) continue;
      yield* noteToChunks(n, await readFile(path, "utf8"));
    }
  },
};

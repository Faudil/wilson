// Generates letters/*.md, *.html, *.expected.json and documents/*.html, *.expected.json from the data file.
// Usage: bun samples/build.ts   (then: bun samples/render.ts for the PNGs)
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DocumentAnalysisSchema, LetterAnalysisSchema } from "@wilson/contracts";
import { DOCUMENTS, LETTERS } from "./letters.data.js";

const here = dirname(fileURLToPath(import.meta.url));
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const CSS = `
@page { size: A4; margin: 0 }
* { box-sizing: border-box }
body { margin: 0; width: 794px; min-height: 1123px; background: #fff; color: #1a1a1a; font-family: "Liberation Serif", "Times New Roman", serif; font-size: 15px; line-height: 1.45; }
.page { padding: 56px 72px 48px; position: relative; min-height: 1123px }
.head { display: flex; justify-content: space-between; border-bottom: 2px solid #1d3a7a; padding-bottom: 14px; margin-bottom: 22px }
.org { font-family: "Liberation Sans", Arial, sans-serif; color: #1d3a7a }
.org b { display: block; font-size: 17px; letter-spacing: .3px; margin-bottom: 2px }
.org span { display: block; font-size: 12px; color: #444 }
.mark { width: 54px; height: 54px; border: 3px solid #1d3a7a; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-family: Arial, sans-serif; font-weight: bold; color: #1d3a7a; font-size: 11px; text-align: center }
.refs { font-size: 12.5px; color: #333; font-family: "Liberation Sans", Arial, sans-serif; margin-bottom: 18px }
.meta { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 26px }
.addr { margin-left: auto; width: 290px; font-size: 15px }
.place { text-align: right; margin-bottom: 18px }
.subject { font-weight: bold; margin: 8px 0 18px }
p { margin: 0 0 11px; text-align: justify }
ul { margin: 0 0 11px; padding-left: 26px }
li { margin-bottom: 3px }
.sig { margin-top: 22px; margin-left: 330px; font-style: italic }
.foot { position: absolute; left: 72px; right: 72px; bottom: 34px; border-top: 1px solid #999; padding-top: 8px; font-size: 11.5px; color: #444; font-family: "Liberation Sans", Arial, sans-serif }
.doc h1 { text-align: center; font-family: "Liberation Sans", Arial, sans-serif; font-size: 20px; margin: 30px 0 30px; color: #1d3a7a; letter-spacing: .5px }
.doc table { width: 100%; border-collapse: collapse; font-size: 16px }
.doc td { border: 1px solid #888; padding: 10px 12px }
.doc td:first-child { width: 38%; background: #f1f3f8; font-family: "Liberation Sans", Arial, sans-serif; font-size: 13px; text-transform: uppercase; color: #333 }
.stamp { margin-top: 40px; text-align: right; font-style: italic }
`;

const page = (title: string, inner: string, cls = "") =>
  `<!doctype html>\n<html lang="fr"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body><div class="page ${cls}">${inner}</div></body></html>\n`;

const head = (lines: string[]) =>
  `<div class="head"><div class="org"><b>${esc(lines[0] ?? "")}</b>${lines.slice(1).map((l) => `<span>${esc(l)}</span>`).join("")}</div><div class="mark">RF<br>LIBERTÉ</div></div>`;

for (const l of LETTERS) {
  // Markdown (plain letter text, used by tests to check quotes verbatim)
  const md = [
    `# ${l.letterhead[0]}`,
    ...l.letterhead.slice(1),
    "",
    ...l.refs,
    "",
    l.place,
    "",
    ...l.recipient,
    "",
    `**Objet : ${l.subject}**`,
    "",
    ...l.body.flatMap((b) => (b.startsWith("- ") ? [b] : ["", b])).slice(0),
    "",
    ...l.signature,
    ...(l.footer ? ["", `---`, l.footer] : []),
    "",
  ].join("\n").replace(/\n{3,}/g, "\n\n");
  writeFileSync(join(here, "letters", `${l.slug}.md`), md);

  // HTML
  let body = "";
  let inList = false;
  for (const b of l.body) {
    if (b.startsWith("- ")) {
      if (!inList) body += "<ul>";
      inList = true;
      body += `<li>${esc(b.slice(2))}</li>`;
    } else {
      if (inList) body += "</ul>";
      inList = false;
      body += `<p>${esc(b)}</p>`;
    }
  }
  if (inList) body += "</ul>";
  const html = page(
    l.subject,
    `${head(l.letterhead)}
<div class="meta"><div class="refs">${l.refs.map(esc).join("<br>")}</div><div class="addr">${l.recipient.map(esc).join("<br>")}</div></div>
<div class="place">${esc(l.place)}</div>
<div class="subject">Objet : ${esc(l.subject)}</div>
${body}
<div class="sig">${l.signature.map(esc).join("<br>")}</div>
${l.footer ? `<div class="foot">${esc(l.footer)}</div>` : ""}`,
  );
  writeFileSync(join(here, "letters", `${l.slug}.html`), html);

  // Expected analysis. `target` = English; per-language prose in `targets`.
  const analysis = LetterAnalysisSchema.parse({ promptVersion: "letter-analysis@1", ...l.facts, fr: l.fr, target: l.en });
  const targets = { en: l.en, ar: l.ar, ...(l.fa ? { fa: l.fa } : {}) };
  writeFileSync(join(here, "letters", `${l.slug}.expected.json`), JSON.stringify({ ...analysis, targets }, null, 2) + "\n");
}

for (const d of DOCUMENTS) {
  const inner = `${head(d.letterhead)}<div class="doc"><h1>${esc(d.title)}</h1><table>${d.fields
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`)
    .join("")}</table><div class="stamp">Cachet et signature de l'autorité<br>(document fictif - échantillon de test)</div></div>`;
  writeFileSync(join(here, "documents", `${d.slug}.html`), page(d.title, inner));
  const a = DocumentAnalysisSchema.parse({ promptVersion: "document-analysis@1", ...d.analysis });
  writeFileSync(join(here, "documents", `${d.slug}.expected.json`), JSON.stringify(a, null, 2) + "\n");
}
console.log(`built ${LETTERS.length} letters, ${DOCUMENTS.length} documents`);

import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractPdfText } from "../src/knowledge/pdf.js";
import { annuaireAdapter, formatOpeningHours } from "../src/knowledge/sources/annuaire.js";
import { associationAdapter } from "../src/knowledge/sources/association.js";
import { servicePublicAdapter, parseFiche } from "../src/knowledge/sources/servicePublic.js";
import { isRelevant } from "../src/knowledge/sources/servicePublicTopics.js";
import { departmentFromFilename, watizatAdapter } from "../src/knowledge/sources/watizat.js";
import { buildTsQuery } from "../src/knowledge/service.js";
import type { KnowledgeChunkInput, SourceAdapter } from "../src/knowledge/types.js";
import { parseXml, textOf } from "../src/knowledge/xml.js";
import { readZip } from "../src/knowledge/zip.js";
import { testConfig } from "./helpers.js";
import { FIXTURES, fakeFetch, fichesZip, makePdf, makeZip } from "./knowledge.helpers.js";
import { readFileSync } from "node:fs";

async function collect(a: SourceAdapter, config: Record<string, string>, f = fakeFetch()): Promise<KnowledgeChunkInput[]> {
  const out: KnowledgeChunkInput[] = [];
  for await (const c of a.fetch({ config: testConfig(config), fetch: f, log: () => undefined })) out.push(c);
  return out;
}

describe("zip + xml", () => {
  it("reads deflated entries from a zip", () => {
    const entries = readZip(makeZip({ "a/one.txt": "héllo", "two.txt": "x".repeat(5000) }));
    expect(entries.map((e) => e.name)).toEqual(["a/one.txt", "two.txt"]);
    expect(entries[0]!.read().toString("utf8")).toBe("héllo");
    expect(entries[1]!.read().length).toBe(5000);
    expect(() => readZip(Buffer.from("not a zip at all, definitely not"))).toThrow(/not a ZIP/);
  });

  it("parses entities, CDATA, attributes and lists", () => {
    const root = parseXml(`<?xml version="1.0"?><!-- c --><a x="1 &amp; 2"><Liste><Item><Paragraphe>un &lt;b&gt;</Paragraphe></Item><Item><![CDATA[deux]]></Item></Liste></a>`);
    expect(root.attrs.x).toBe("1 & 2");
    expect(textOf(root)).toBe("- un <b>\n- deux");
  });
});

describe("Service-Public adapter", () => {
  it("keeps relevant fiches, drops others, chunks per section", async () => {
    const chunks = await collect(servicePublicAdapter, {});
    const ids = new Set(chunks.map((c) => c.externalId.split("#")[0]));
    expect([...ids].sort()).toEqual(["F18074", "F2741", "F3079"]);
    const titles = chunks.map((c) => c.title);
    expect(titles).toContain("Renouvellement d'un titre de séjour — Présentation");
    expect(titles).toContain("Renouvellement d'un titre de séjour — Quand faire la demande ?");
    expect(titles).toContain("Aide médicale de l'État (AME) : conditions et démarches — Renouvellement");
    const quand = chunks.find((c) => c.title.endsWith("Quand faire la demande ?"))!;
    expect(quand.text).toContain("- Passeport en cours de validité");
    expect(quand.text).not.toContain("Quand faire la demande ?");
    expect(quand).toMatchObject({ kind: "procedure", department: null, url: "https://www.service-public.fr/particuliers/vosdroits/F2741" });
    expect(quand.sourceUpdatedAt?.toISOString().slice(0, 10)).toBe("2025-09-12");
    expect(chunks.every((c) => c.text.length <= 1500)).toBe(true);
    expect(new Set(chunks.map((c) => c.externalId)).size).toBe(chunks.length);
  });

  it("uses SERVICE_PUBLIC_ZIP_URL and fails loudly on HTTP errors or empty archives", async () => {
    const f = fakeFetch({ zip: fichesZip() });
    await expect(collect(servicePublicAdapter, { SERVICE_PUBLIC_ZIP_URL: "https://example.test/other.zip" }, f)).rejects.toThrow(/HTTP 404/);
    expect(f.calls[0]).toBe("https://example.test/other.zip");
    await expect(collect(servicePublicAdapter, {}, fakeFetch({ status: 503 }))).rejects.toThrow(/HTTP 503/);
    await expect(collect(servicePublicAdapter, {}, fakeFetch({ zip: makeZip({ "x/F1.xml": "<Publication ID='F1' type='Fiche'><dc:title>Permis de chasser</dc:title></Publication>" }) }))).rejects.toThrow(/aucune fiche/);
  });

  it("relevance rules: theme, id, keywords (accent-insensitive), whole-word acronyms", () => {
    expect(isRelevant({ id: "F1", title: "Autre", themeIds: ["N19804"] })).toBe(true);
    expect(isRelevant({ id: "F1", title: "Demande de Prime d’activité" })).toBe(true);
    expect(isRelevant({ id: "F1", title: "Comment obtenir l'APL ?" })).toBe(true);
    expect(isRelevant({ id: "F1", title: "Chapitre sur la capitale" })).toBe(false);
    expect(isRelevant({ id: "F1", title: "Permis de chasser", breadcrumb: ["Loisirs"] })).toBe(false);
  });

  it("parseFiche ignores non-fiches", () => {
    expect(parseFiche(readFileSync(join(FIXTURES, "fiches/N19804.xml"), "utf8"))).toBeNull();
  });
});

describe("Annuaire adapter", () => {
  const cfg = { KNOWLEDGE_DEPARTMENTS: "75", ANNUAIRE_TYPES: "prefecture,point_justice,caf" };

  it("maps Opendatasoft records (JSON-string and JSON columns) to contact chunks", async () => {
    const f = fakeFetch();
    const chunks = await collect(annuaireAdapter, cfg, f);
    expect(chunks.map((c) => c.title).sort()).toEqual(["Caisse d'allocations familiales de Paris", "Point-justice de Paris 10e", "Préfecture de police de Paris"]);
    expect(chunks.every((c) => c.kind === "contact" && c.department === "75")).toBe(true); // Rhône record dropped
    const pref = chunks.find((c) => c.title.startsWith("Préfecture"))!;
    expect(pref.text).toBe(
      [
        "Type : Préfecture",
        "Adresse : 9 Boulevard du Palais, 75004 Paris",
        "Téléphone : 34 30 Standard",
        "Horaires : du lundi au vendredi de 8h30 à 12h30 et de 13h30 à 17h",
        "Site internet : https://www.prefecturedepolice.interieur.gouv.fr",
      ].join("\n"),
    );
    expect(pref.url).toContain("lannuaire.service-public.fr");
    const pj = chunks.find((c) => c.title.startsWith("Point-justice"))!;
    expect(pj.text).toContain("Horaires : le mardi de 9h à 12h (sur rendez-vous)");
    expect(pj.text).toContain("Type : Point-justice");
    const url = new URL(f.calls[0]!);
    expect(url.searchParams.get("limit")).toBe("100");
    expect(url.searchParams.get("where")).toContain("75");
  });

  it("formats opening hours defensively", () => {
    expect(formatOpeningHours("not json")).toBe("");
    expect(formatOpeningHours(null)).toBe("");
    expect(formatOpeningHours([{ nom_jour_debut: "Samedi", nom_jour_fin: "Samedi", valeur_heure_debut_1: "10:00:00", valeur_heure_fin_1: "12:00:00" }])).toBe("le samedi de 10h à 12h");
  });

  it("errors when nothing matches or the API fails", async () => {
    await expect(collect(annuaireAdapter, { ...cfg, KNOWLEDGE_DEPARTMENTS: "13" })).rejects.toThrow(/aucun service/);
    await expect(collect(annuaireAdapter, cfg, fakeFetch({ status: 500 }))).rejects.toThrow(/HTTP 500/);
  });
});

describe("Association adapter", () => {
  it("one chunk per ## section with front-matter metadata; README ignored", async () => {
    const dir = mkdtempSync(join(tmpdir(), "kb-"));
    mkdirSync(join(dir, "association"));
    writeFileSync(join(dir, "association/README.md"), "# readme\n\n## Ignored\nx");
    writeFileSync(join(dir, "association/note.md"), readFileSync(join(FIXTURES, "association/note-test.md")));
    const chunks = await collect(associationAdapter, { KNOWLEDGE_DIR: dir });
    expect(chunks.map((c) => c.title)).toEqual(["Aide aux démarches — Présentation", "Aide aux démarches — Accompagnement CAF", "Aide aux démarches — Cours de français"]);
    expect(chunks[1]).toMatchObject({ department: "75", url: "https://example.org/aide", kind: "guide", externalId: "note#accompagnement-caf" });
    expect(chunks[1]!.text).toBe("Un bénévole aide à remplir le dossier CAF et la prime d'activité, le mercredi.");
  });

  it("returns nothing for a missing folder", async () => {
    expect(await collect(associationAdapter, { KNOWLEDGE_DIR: join(tmpdir(), "does-not-exist-kb") })).toEqual([]);
  });

  it("the shipped example note parses", async () => {
    const chunks = await collect(associationAdapter, { KNOWLEDGE_DIR: join(FIXTURES, "../../../../../knowledge") });
    expect(chunks.map((c) => c.title.split(" — ")[1])).toEqual(expect.arrayContaining(["Permanence juridique", "Cours de français", "Domiciliation"]));
    expect(chunks.every((c) => c.kind === "contact" && c.department === "75")).toBe(true);
  });
});

describe("Watizat adapter + PDF extraction", () => {
  it("extracts text from a Flate PDF and chunks by heading", async () => {
    const pdf = makePdf(["SANTE ET ACCES AUX SOINS", "Pour demander l'AME, rendez-vous à la CPAM avec votre passeport et un justificatif de présence en France.", "LOGEMENT D'URGENCE", "Appelez le 115 pour une place d'hébergement d'urgence, de préférence avant 17h."]);
    const text = extractPdfText(pdf);
    expect(text).toContain("l'AME, rendez-vous à la CPAM");
    const dir = mkdtempSync(join(tmpdir(), "kb-"));
    mkdirSync(join(dir, "watizat"));
    writeFileSync(join(dir, "watizat/watizat-lyon.pdf"), pdf);
    const chunks = await collect(watizatAdapter, { KNOWLEDGE_DIR: dir });
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({ kind: "guide", department: "69", title: "Guide Watizat Lyon — SANTE ET ACCES AUX SOINS" });
    expect(chunks[1]!.text).toContain("115");
  });

  it("returns empty text for garbage and maps cities to départements", () => {
    expect(extractPdfText(Buffer.from("not a pdf"))).toBe("");
    expect(departmentFromFilename("Guide-Watizat-Strasbourg-2024.pdf")).toBe("67");
    expect(departmentFromFilename("watizat-paris.pdf")).toBe("75");
    expect(departmentFromFilename("autre.pdf")).toBeNull();
  });
});

describe("query building", () => {
  it("strips stopwords and ORs the rest", () => {
    expect(buildTsQuery("Je dois renouveler mon titre de séjour à la préfecture")).toBe("dois | renouveler | titre | séjour | préfecture");
    expect(buildTsQuery("le la de")).toBeNull();
    expect(buildTsQuery("l'AME; DROP TABLE x --")).toBe("ame | drop | table");
  });
});

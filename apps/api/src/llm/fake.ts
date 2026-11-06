import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DocumentAnalysisSchema,
  LetterAnalysisSchema,
  LetterTextSchema,
  type DocumentAnalysis,
  type LanguageCode,
  type LetterAnalysis,
  type LetterText,
} from "@wilson/contracts";
import type { LlmFile, LlmProvider } from "./provider.js";

/** Find the repo's /samples directory: $SAMPLES_DIR, else walk up from this file and from cwd. */
export function resolveSamplesDir(): string {
  if (process.env.SAMPLES_DIR) return resolve(process.env.SAMPLES_DIR);
  for (const start of [dirname(fileURLToPath(import.meta.url)), process.cwd()]) {
    let dir = start;
    for (let i = 0; i < 10; i++) {
      if (existsSync(join(dir, "samples", "letters"))) return join(dir, "samples");
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new Error("Cannot find the samples directory (set SAMPLES_DIR)");
}

const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");

/** Index `<dir>/*.png|pdf|jpg` by content hash -> parsed `*.expected.json` (same basename). */
function indexFixtures(dir: string): Map<string, unknown> {
  const map = new Map<string, unknown>();
  if (!existsSync(dir)) return map;
  for (const f of readdirSync(dir)) {
    const m = /^(.*)\.(png|pdf|jpe?g|webp)$/.exec(f);
    if (!m) continue;
    const expected = join(dir, `${m[1]}.expected.json`);
    if (!existsSync(expected)) continue;
    map.set(sha256(readFileSync(join(dir, f))), JSON.parse(readFileSync(expected, "utf8")));
  }
  return map;
}

const tag = (lang: LanguageCode, s: string) => `[${lang}] ${s}`;
const tagText = (t: LetterText, lang: LanguageCode): LetterText => ({
  title: tag(lang, t.title),
  summary: tag(lang, t.summary),
  actions: t.actions.map((a) => tag(lang, a)),
  orientation: t.orientation.map((o) => tag(lang, o)),
});

const GENERIC_FR: LetterText = {
  title: "Courrier officiel que nous n'avons pas pu analyser en détail.",
  summary:
    "Ce courrier semble venir d'une administration, mais nous ne sommes pas sûrs de ce qu'il demande. Un bénévole va le lire avec vous.",
  actions: ["Gardez ce courrier avec vos papiers importants."],
  orientation: ["Venez à l'association avec ce courrier : un bénévole vous l'expliquera."],
};
const GENERIC: Partial<Record<LanguageCode, LetterText>> = {
  en: {
    title: "Official letter that we could not analyse in detail.",
    summary:
      "This letter seems to come from an administration, but we are not sure what it asks. A volunteer will read it with you.",
    actions: ["Keep this letter with your important papers."],
    orientation: ["Come to the association with this letter: a volunteer will explain it to you."],
  },
  ar: {
    title: "رسالة رسمية لم نتمكن من تحليلها بالتفصيل.",
    summary: "يبدو أن هذه الرسالة من إدارة ما، لكننا لسنا متأكدين مما تطلبه. سيقرأها معك أحد المتطوعين.",
    actions: ["احتفظ بهذه الرسالة مع أوراقك المهمة."],
    orientation: ["تعال إلى الجمعية ومعك هذه الرسالة: سيشرحها لك أحد المتطوعين."],
  },
};

/** Deterministic, offline provider. Fixture lookup by file sha256; see samples/README.md. */
export class FakeProvider implements LlmProvider {
  readonly name = "fake";
  private letters?: Map<string, unknown>;
  private documents?: Map<string, unknown>;

  constructor(private readonly samplesDir?: string) {}

  private dir(sub: string) {
    return join(this.samplesDir ?? resolveSamplesDir(), sub);
  }

  async analyzeLetter(input: { file: LlmFile; targetLanguage: LanguageCode; today: string }): Promise<LetterAnalysis> {
    this.letters ??= indexFixtures(this.dir("letters"));
    const lang = input.targetLanguage;
    const fixture = this.letters.get(sha256(input.file.bytes)) as
      | (LetterAnalysis & { targets?: Partial<Record<LanguageCode, LetterText>> })
      | undefined;
    if (fixture) {
      const { targets, ...base } = fixture;
      const parsed = LetterAnalysisSchema.parse(base);
      const target = lang === "fr" ? parsed.fr : (targets?.[lang] ?? tagText(parsed.fr, lang));
      return { ...parsed, target: LetterTextSchema.parse(target) };
    }
    return LetterAnalysisSchema.parse({
      promptVersion: "letter-analysis@1",
      isOfficialLetter: true,
      letterType: "other_official",
      issuer: null,
      references: [],
      letterDate: null,
      deadline: null,
      urgency: "low",
      confidence: 0.3,
      reviewerWarnings: ["Analyse factice (FakeProvider) : courrier inconnu, à lire entièrement."],
      fr: GENERIC_FR,
      target: lang === "fr" ? GENERIC_FR : (GENERIC[lang] ?? tagText(GENERIC_FR, lang)),
    });
  }

  async analyzeDocument(input: { file: LlmFile; today: string }): Promise<DocumentAnalysis> {
    this.documents ??= indexFixtures(this.dir("documents"));
    const fixture = this.documents.get(sha256(input.file.bytes));
    if (fixture) return DocumentAnalysisSchema.parse(fixture);
    return DocumentAnalysisSchema.parse({
      promptVersion: "document-analysis@1",
      type: "other",
      expiresAt: null,
      expirySourceQuote: null,
      confidence: 0.3,
    });
  }

  async detectLanguage(input: { text: string }): Promise<{ language: LanguageCode | null; confidence: number }> {
    return detectLanguageHeuristic(input.text);
  }

  async translateLetterText(input: { fr: LetterText; targetLanguage: LanguageCode }): Promise<LetterText> {
    return input.targetLanguage === "fr" ? input.fr : tagText(input.fr, input.targetLanguage);
  }
}

const WORDS: Record<"fr" | "en" | "so", string[]> = {
  fr: ["bonjour", "bonsoir", "salut", "merci", "courrier", "lettre", "je ", "j'ai", "une ", "des ", "les ", "aide", "svp", "madame", "monsieur"],
  en: ["hello", "hi ", "thanks", "thank", "letter", "help", "please", "my ", "the ", "i ", "have", "need", "good "],
  so: ["salaan", "mahadsanid", "waan", "iyo", "ayaa", "fadlan", "kaalmo", "warqad", "waxaan", "maalin", "nabad"],
};

export function detectLanguageHeuristic(text: string): { language: LanguageCode | null; confidence: number } {
  const t = text.trim().toLowerCase();
  if (!t) return { language: null, confidence: 0 };
  const count = (re: RegExp) => (t.match(re) ?? []).length;
  const ethiopic = count(/[ሀ-፿]/g);
  const arabic = count(/[؀-ۿݐ-ݿ]/g);
  const cyrillic = count(/[Ѐ-ӿ]/g);
  const latin = count(/[a-zà-ÿ]/g);
  const max = Math.max(ethiopic, arabic, cyrillic, latin);
  if (max === 0) return { language: null, confidence: 0 };
  if (max === ethiopic) {
    const ti = ["ከመይ", "ደሓን", "ሰላም ኢኻ", "የቐንየለይ", "ኣብ", "ኣነ", "እዩ"];
    return { language: ti.some((w) => t.includes(w)) ? "ti" : "am", confidence: 0.8 };
  }
  if (max === cyrillic) return { language: "uk", confidence: 0.9 };
  if (max === arabic) {
    if (/[ټډړږښڼ]/.test(t)) return { language: "ps", confidence: 0.85 };
    if (/[ٹڈڑںےھۓ]/.test(t)) return { language: "ur", confidence: 0.85 };
    if (/[پچژگ]/.test(t) || /(^|\s)(می|است|هستم|من|شما|سلام)(\s|$)/.test(t)) return { language: "fa", confidence: 0.75 };
    return { language: "ar", confidence: 0.85 };
  }
  const score = (l: "fr" | "en" | "so") => WORDS[l].filter((w) => (t + " ").includes(w)).length;
  const scores = (["fr", "en", "so"] as const).map((l) => [l, score(l)] as const).sort((a, b) => b[1] - a[1]);
  const [best, second] = scores;
  if (!best || best[1] === 0) return { language: null, confidence: 0 };
  if (second && second[1] === best[1]) return { language: null, confidence: 0.3 };
  return { language: best[0], confidence: 0.85 };
}

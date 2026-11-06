/**
 * Which Service-Public.fr fiches are kept. Easy to extend: add a theme id, a fiche id or a keyword.
 * A fiche is kept when ANY of these matches (theme ids are matched against the fiche's theme / sub-theme / breadcrumb ids).
 */

/** Themes ("N…" ids from the Service-Public taxonomy) whose whole subtree is relevant. */
export const THEME_IDS = new Set<string>([
  "N19804", // Étranger (séjour, asile, nationalité…)
]);

/** Individual fiches always kept (add ids here, e.g. "F2741"). */
export const FICHE_IDS = new Set<string>([
  "F2741", // Renouvellement d'un titre de séjour
]);

/**
 * Keywords searched (case/accent-insensitive) in the fiche title, subject and breadcrumb.
 * Grouped by the situation they cover so volunteers can see what is missing.
 */
export const KEYWORDS: Record<string, string[]> = {
  etrangers: ["titre de sejour", "carte de sejour", "recepisse", "demande d'asile", "demandeur d'asile", "refugie", "protection subsidiaire", "apatride", "naturalisation", "nationalite francaise", "visa long sejour", "regroupement familial", "obligation de quitter le territoire", "oqtf", "etranger", "ofii", "contrat d'integration republicaine", "passeport talent", "carte de resident"],
  prestations: ["caf", "allocations familiales", "rsa", "revenu de solidarite active", "prime d'activite", "apl", "aide personnalisee au logement", "aides au logement", "allocation de rentree scolaire", "complement familial", "allocation adulte handicape", "allocation de soutien familial", "css", "complementaire sante solidaire"],
  sante: ["aide medicale de l'etat", "puma", "protection universelle maladie", "assurance maladie", "carte vitale", "mutuelle"],
  logement: ["logement social", "demande de logement", "expulsion", "hebergement d'urgence", "115", "dalo", "droit au logement opposable", "bail", "loyer impaye", "locataire", "caution", "domiciliation", "mal-loge", "sans-abri"],
  travail: ["france travail", "pole emploi", "inscription comme demandeur d'emploi", "allocation de retour a l'emploi", "autorisation de travail", "contrat de travail", "licenciement", "salaire", "chomage", "formation professionnelle"],
  impots: ["declaration de revenus", "declaration des revenus", "avis d'imposition", "impot sur le revenu", "taxe d'habitation", "taxe fonciere", "numero fiscal", "prelevement a la source"],
  justice: ["aide juridictionnelle", "aide juridique", "tribunal administratif", "recours contre", "recours gracieux", "recours contentieux", "avocat", "point-justice", "maison de justice", "defenseur des droits"],
  banque: ["droit au compte", "compte bancaire", "ouverture d'un compte", "livret a"],
};

const fold = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’‘]/g, "'");

const SHORT_WORDS = new Set(["caf", "rsa", "apl", "css", "puma", "115", "oqtf", "ofii", "dalo"]);

/** Whole-word match for short acronyms, substring match for phrases. */
function mentions(haystack: string, kw: string): boolean {
  if (SHORT_WORDS.has(kw)) return new RegExp(`(^|[^a-z0-9])${kw}($|[^a-z0-9])`).test(haystack);
  return haystack.includes(kw);
}

export function isRelevant(f: { id: string; title: string; subject?: string; breadcrumb?: string[]; themeIds?: string[] }): boolean {
  if (FICHE_IDS.has(f.id)) return true;
  if (f.themeIds?.some((t) => THEME_IDS.has(t))) return true;
  const hay = fold([f.title, f.subject ?? "", ...(f.breadcrumb ?? [])].join(" | "));
  return Object.values(KEYWORDS).some((list) => list.some((kw) => mentions(hay, fold(kw))));
}

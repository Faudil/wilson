import type { LetterAnalysis, LetterType } from "@wilson/contracts";

/** French keyword hint per letter type, appended to the search query (full-text search is lexical). */
const LETTER_TYPE_HINTS: Record<LetterType, string> = {
  prefecture_removal_order: "obligation de quitter le territoire recours tribunal administratif aide juridictionnelle point-justice",
  prefecture_residence_permit: "titre de séjour préfecture rendez-vous récépissé",
  ofpra_convocation: "demande d'asile OFPRA entretien convocation",
  ofpra_decision: "OFPRA décision recours CNDA aide juridictionnelle avocat point-justice",
  cnda: "CNDA recours décision aide juridictionnelle avocat point-justice",
  ofii: "OFII allocation demandeur d'asile hébergement",
  caf: "caf allocations justificatifs",
  cpam: "cpam assurance maladie couverture santé AME carte vitale",
  france_travail: "france travail inscription rendez-vous",
  tax: "impôts déclaration centre des finances publiques",
  housing: "logement bailleur loyer impayé 115 SIAO aide juridique",
  court: "tribunal convocation aide juridictionnelle point-justice avocat",
  school: "école inscription scolaire mairie",
  bank: "banque compte droit au compte",
  other_official: "administration courrier officiel accompagnement",
  not_official: "",
};

/** title + issuer + hint + summary, capped at 500 chars (the summary is what gets cut, never the hint). */
export function buildRagQuery(a: LetterAnalysis): string {
  const head = [a.fr.title, a.issuer ?? "", LETTER_TYPE_HINTS[a.letterType]].filter(Boolean).join(" ");
  return `${head} ${a.fr.summary}`.trim().slice(0, 500);
}

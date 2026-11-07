/**
 * Keyword safety net for emergencies, used on top of the LLM classifier (never instead of it).
 * Matching only sends the fixed emergency numbers (115, 15, 17, 112, 119, 114) and flags the conversation for a
 * person: a false positive costs one extra message, a miss can cost a night outside. Keep the list short and plain.
 *
 * The beneficiary's own text is checked, and its French translation when we have one, so the French list covers
 * every language the translation works for; a few native words cover the case where translation failed.
 */
const PATTERNS: RegExp[] = [
  // French (also the translation of every other language)
  /\b(dormir|dors|dormons)\b.{0,30}\b(dehors|rue|ce soir|cette nuit)\b/i,
  /(?:^|\s)(à|a) la rue\b|\bsans (abri|logement|toit)\b|\bnulle part o[uù] dormir|\bpas d[e'] ?(endroit|logement|place) pour (dormir|ce soir|cette nuit)/i,
  /\bsuicid|\bme tuer\b|\b(envie de|veux) mourir\b/i,
  /\b(frapp[ée]|battue?\b|viol[ée]e?\b|violences?\b|menac[ée]e?s? de mort)/i,
  /\b(saigne|saignement|perd connaissance|ne respire|urgence m[ée]dicale)/i,
  // English
  /\b(sleep|sleeping)\b.{0,30}\b(outside|street|tonight)\b|\bhomeless\b|\bnowhere to (sleep|stay|go)\b/i,
  /\bsuicid|\bkill myself\b|\bwant to die\b|\bbeaten\b|\braped?\b|\bbleeding\b|\bcan'?t breathe\b/i,
  // A few native words (Arabic, Dari/Persian, Pashto, Ukrainian/Russian, Spanish, Portuguese, Turkish)
  /أنام في الشارع|في الشارع|بلا مأوى|انتحار|أقتل نفسي|نزيف|اغتصاب/,
  /خیابان بخوابم|بی خانمان|خودکشی|خونریزی|تجاوز/,
  /په سړک|ځان وژنه/,
  /на вулиці|на улице|бездомн|самогуб|самоуб|кровотеч/i,
  /\ben la calle\b|\bsuicid|\bme quiero morir\b/i,
  /\bna rua\b|\bsuic[ií]d/i,
  /\bsokakta\b|\bintihar\b/i,
];

export function looksUrgent(text: string, textFr: string | null): boolean {
  return [text, textFr ?? ""].some((t) => t && PATTERNS.some((re) => re.test(t)));
}

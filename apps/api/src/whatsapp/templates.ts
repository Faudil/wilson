import { LANGUAGE_CODES, type LanguageCode } from "@wilson/contracts";
import { documentTypeName, formatDate } from "@wilson/i18n";

/**
 * Meta-approved message templates ("utility" category), the only thing WhatsApp lets us send when the person has
 * not written for more than 24 h. Their text lives here (not in the i18n catalogs) because it is submitted to Meta
 * once by `bun run --filter @wilson/api wa:setup templates` and must then match what was approved, word for word.
 *
 * Rules Meta enforces at submission (checked by test/wa.templates.test.ts):
 * - a body may not start or end with a variable, and variables are numbered {{1}}, {{2}}… in order;
 * - body ≤ 1024 characters, quick-reply button ≤ 25 characters;
 * - only the languages in META_TEMPLATE_LANGUAGE exist on Meta's side.
 * No legal advice in templates: they only say that something is waiting, or that a document expires.
 * Translations other than fr/en are machine-drafted and must be reviewed by a native speaker (see D7).
 */

/** Our language code → Meta template language code. null = Meta has no template support for that language. */
export const META_TEMPLATE_LANGUAGE: Record<LanguageCode, string | null> = {
  fr: "fr", en: "en", ar: "ar", fa: "fa", ps: null, ur: "ur", uk: "uk", ti: null, so: null, am: null,
  ru: "ru", es: "es", pt: "pt_PT", tr: "tr", ku: null, ckb: null, bn: "bn", ta: "ta", ka: "ka", hy: null,
  sq: "sq", ro: "ro", ht: null, wo: null, ff: null, bm: null, ln: null, sw: "sw",
};

/**
 * For languages Meta does not support, which approved template the person most likely reads.
 * Only the short "something is waiting" notice is affected: the real message is sent in their own language
 * as soon as they answer. Pashto → Dari (Afghanistan's lingua franca); Horn of Africa → English; the rest → French.
 */
const UNSUPPORTED_FALLBACK: Partial<Record<LanguageCode, LanguageCode>> = { ps: "fa", ti: "en", am: "en", so: "en" };

/** Language a template is actually sent in for a beneficiary language (always one we define templates for). */
export function templateLanguageFor(lang: LanguageCode): LanguageCode {
  if (META_TEMPLATE_LANGUAGE[lang]) return lang;
  return UNSUPPORTED_FALLBACK[lang] ?? "fr";
}

export type TemplateId = "explanation_ready" | "document_reminder";

interface TemplateText {
  /** `{association}` is replaced by ASSOCIATION_NAME at submission time; {{1}}/{{2}} are Meta variables. */
  explanationReady: string;
  receiveButton: string;
  documentReminder: string;
}

const T: Partial<Record<LanguageCode, TemplateText>> = {
  fr: {
    explanationReady: "Bonjour, c'est {association}. Nous avons une réponse à votre demande. Appuyez sur « Recevoir » ou répondez à ce message pour la lire.",
    receiveButton: "Recevoir",
    documentReminder: "Rappel de {association} : votre document « {{1}} » expire le {{2}}. Pensez à le renouveler à temps. Répondez à ce message si vous avez besoin d'aide.",
  },
  en: {
    explanationReady: "Hello, this is {association}. We have a reply to your request. Tap \"Receive\" or reply to this message to read it.",
    receiveButton: "Receive",
    documentReminder: "Reminder from {association}: your document \"{{1}}\" expires on {{2}}. Remember to renew it in time. Reply to this message if you need help.",
  },
  ar: {
    explanationReady: "مرحبًا، معك {association}. لدينا رد على طلبك. اضغط على «استلام» أو أرسل أي رسالة لقراءته.",
    receiveButton: "استلام",
    documentReminder: "تذكير من {association}: وثيقتك «{{1}}» تنتهي صلاحيتها في {{2}}. لا تنسَ تجديدها في الوقت المناسب. أرسل لنا رسالة إذا كنت بحاجة إلى مساعدة.",
  },
  fa: {
    explanationReady: "سلام، اینجا {association} است. ما به درخواست شما پاسخ داریم. برای خواندن آن روی «دریافت» بزنید یا به این پیام جواب دهید.",
    receiveButton: "دریافت",
    documentReminder: "یادآوری از {association}: سند شما «{{1}}» در تاریخ {{2}} منقضی می‌شود. لطفاً به موقع آن را تمدید کنید. اگر به کمک نیاز دارید، به این پیام جواب دهید.",
  },
  ur: {
    explanationReady: "السلام علیکم، یہ {association} ہے۔ آپ کی درخواست کا جواب تیار ہے۔ اسے پڑھنے کے لیے «وصول کریں» پر ٹیپ کریں یا اس پیغام کا جواب دیں۔",
    receiveButton: "وصول کریں",
    documentReminder: "{association} کی جانب سے یاد دہانی: آپ کی دستاویز «{{1}}» کی میعاد {{2}} کو ختم ہو رہی ہے۔ براہ کرم وقت پر اس کی تجدید کروائیں۔ مدد کے لیے اس پیغام کا جواب دیں۔",
  },
  uk: {
    explanationReady: "Вітаємо, це {association}. У нас є відповідь на ваш запит. Натисніть «Отримати» або дайте відповідь на це повідомлення, щоб її прочитати.",
    receiveButton: "Отримати",
    documentReminder: "Нагадування від {association}: термін дії вашого документа «{{1}}» спливає {{2}}. Не забудьте вчасно його поновити. Якщо потрібна допомога, дайте відповідь на це повідомлення.",
  },
  ru: {
    explanationReady: "Здравствуйте, это {association}. У нас есть ответ на ваш запрос. Нажмите «Получить» или ответьте на это сообщение, чтобы его прочитать.",
    receiveButton: "Получить",
    documentReminder: "Напоминание от {association}: срок действия вашего документа «{{1}}» истекает {{2}}. Не забудьте вовремя его продлить. Если нужна помощь, ответьте на это сообщение.",
  },
  es: {
    explanationReady: "Hola, somos {association}. Tenemos una respuesta a su solicitud. Pulse «Recibir» o responda a este mensaje para leerla.",
    receiveButton: "Recibir",
    documentReminder: "Recordatorio de {association}: su documento «{{1}}» caduca el {{2}}. No olvide renovarlo a tiempo. Responda a este mensaje si necesita ayuda.",
  },
  pt: {
    explanationReady: "Olá, aqui é {association}. Temos uma resposta ao seu pedido. Toque em «Receber» ou responda a esta mensagem para a ler.",
    receiveButton: "Receber",
    documentReminder: "Lembrete de {association}: o seu documento «{{1}}» expira em {{2}}. Não se esqueça de o renovar a tempo. Responda a esta mensagem se precisar de ajuda.",
  },
  tr: {
    explanationReady: "Merhaba, biz {association}. Talebinize bir yanıtımız var. Okumak için «Yanıtı al» düğmesine dokunun veya bu mesaja yanıt verin.",
    receiveButton: "Yanıtı al",
    documentReminder: "{association} hatırlatması: «{{1}}» belgenizin süresi {{2}} tarihinde doluyor. Zamanında yenilemeyi unutmayın. Yardıma ihtiyacınız olursa bu mesaja yanıt verin.",
  },
  bn: {
    explanationReady: "হ্যালো, এটি {association}। আপনার অনুরোধের একটি উত্তর আমাদের কাছে আছে। পড়তে «গ্রহণ করুন» চাপুন অথবা এই বার্তার উত্তর দিন।",
    receiveButton: "গ্রহণ করুন",
    documentReminder: "{association}-এর পক্ষ থেকে মনে করিয়ে দেওয়া হচ্ছে: আপনার «{{1}}»-এর মেয়াদ {{2}} তারিখে শেষ হবে। সময়মতো নবায়ন করতে ভুলবেন না। সাহায্য প্রয়োজন হলে এই বার্তার উত্তর দিন।",
  },
  ta: {
    explanationReady: "வணக்கம், இது {association}. உங்கள் கோரிக்கைக்கு எங்களிடம் பதில் உள்ளது. அதைப் படிக்க «பெறு» என்பதைத் தட்டவும் அல்லது இந்தச் செய்திக்குப் பதிலளிக்கவும்.",
    receiveButton: "பெறு",
    documentReminder: "{association} நினைவூட்டல்: உங்கள் «{{1}}» ஆவணம் {{2}} அன்று காலாவதியாகிறது. சரியான நேரத்தில் புதுப்பிக்க மறக்காதீர்கள். உதவி தேவைப்பட்டால் இந்தச் செய்திக்குப் பதிலளிக்கவும்.",
  },
  ka: {
    explanationReady: "გამარჯობა, ეს არის {association}. თქვენს მოთხოვნაზე პასუხი გვაქვს. წასაკითხად დააჭირეთ «მიღებას» ან უპასუხეთ ამ შეტყობინებას.",
    receiveButton: "მიღება",
    documentReminder: "შეხსენება {association}-სგან: თქვენი დოკუმენტის «{{1}}» ვადა იწურება {{2}}. არ დაგავიწყდეთ დროულად განახლება. თუ დახმარება გჭირდებათ, უპასუხეთ ამ შეტყობინებას.",
  },
  sq: {
    explanationReady: "Përshëndetje, jemi {association}. Kemi një përgjigje për kërkesën tuaj. Shtypni «Merr» ose përgjigjuni këtij mesazhi për ta lexuar.",
    receiveButton: "Merr",
    documentReminder: "Kujtesë nga {association}: dokumenti juaj «{{1}}» skadon më {{2}}. Mos harroni ta rinovoni në kohë. Përgjigjuni këtij mesazhi nëse keni nevojë për ndihmë.",
  },
  ro: {
    explanationReady: "Bună ziua, aici {association}. Avem un răspuns la solicitarea dumneavoastră. Apăsați «Primește» sau răspundeți la acest mesaj pentru a-l citi.",
    receiveButton: "Primește",
    documentReminder: "Memento de la {association}: documentul dumneavoastră „{{1}}” expiră pe {{2}}. Nu uitați să îl reînnoiți la timp. Răspundeți la acest mesaj dacă aveți nevoie de ajutor.",
  },
  sw: {
    explanationReady: "Habari, hii ni {association}. Tuna jibu la ombi lako. Gusa «Pokea» au ujibu ujumbe huu ili kulisoma.",
    receiveButton: "Pokea",
    documentReminder: "Kikumbusho kutoka {association}: hati yako «{{1}}» itaisha muda wake tarehe {{2}}. Kumbuka kuisasisha kwa wakati. Jibu ujumbe huu ukihitaji msaada.",
  },
};

/** Languages templates are defined (and submitted) for: every language Meta supports among ours. */
export const TEMPLATE_LANGUAGES = LANGUAGE_CODES.filter((l) => META_TEMPLATE_LANGUAGE[l] !== null);

/** Payload for `POST /{WABA_ID}/message_templates` (Graph API). */
export interface TemplateDefinition {
  name: string;
  language: string;
  category: "UTILITY";
  components: Record<string, unknown>[];
}

export function templateDefinitions(opts: { associationName: string; names: Record<TemplateId, string> }): TemplateDefinition[] {
  const out: TemplateDefinition[] = [];
  for (const lang of TEMPLATE_LANGUAGES) {
    const t = T[lang];
    if (!t) throw new Error(`missing template text for ${lang}`);
    const fill = (s: string) => s.replaceAll("{association}", opts.associationName);
    const metaLang = META_TEMPLATE_LANGUAGE[lang]!;
    out.push({
      name: opts.names.explanation_ready, language: metaLang, category: "UTILITY",
      components: [
        { type: "BODY", text: fill(t.explanationReady) },
        { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: t.receiveButton }] },
      ],
    });
    out.push({
      name: opts.names.document_reminder, language: metaLang, category: "UTILITY",
      components: [{
        type: "BODY", text: fill(t.documentReminder),
        example: { body_text: [[documentTypeName("recepisse", lang), formatDate("2027-03-14", lang)]] },
      }],
    });
  }
  return out;
}

/** Raw text (for tests and the setup guide). */
export function templateText(lang: LanguageCode): TemplateText | undefined {
  return T[lang];
}

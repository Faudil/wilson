import type { LanguageCode } from "@wilson/contracts";

/** Test fixtures for the language test page. Pashto and Dari sentences deliberately use the script-specific letters. */
export type LanguageSample = {
  sentence: string;
  addressLabel: string;
  referenceLabel: string;
  /** Primary font family name, as declared in fonts.css. */
  font: string;
  /** Letters that must render without fallback boxes. */
  special?: string;
};

export const TEST_ADDRESS = "12 rue de l'Exemple, 75010 Paris";
export const TEST_REFERENCE = "AB-2027-004512";
export const TEST_DATE = "2027-03-14";

export const SAMPLES: Record<LanguageCode, LanguageSample> = {
  fr: {
    sentence: "Vous devez répondre à la préfecture avant le 14 mars 2027 en envoyant les pièces demandées.",
    addressLabel: "Adresse",
    referenceLabel: "Référence",
    font: "Noto Sans",
  },
  en: {
    sentence: "You must reply to the prefecture before 14 March 2027 by sending the documents requested.",
    addressLabel: "Address",
    referenceLabel: "Reference",
    font: "Noto Sans",
  },
  ar: {
    sentence: "يجب عليك الرد على المحافظة قبل ١٤ مارس ٢٠٢٧ وإرسال الوثائق المطلوبة.",
    addressLabel: "العنوان",
    referenceLabel: "رقم المرجع",
    font: "Noto Sans Arabic",
  },
  fa: {
    sentence: "این نامه از ادارهٔ مهاجرت است. پیش از ۱۴ مارچ ۲۰۲۷ اسناد چاپ‌شده را بفرستید و از خانۀ خود پیگیری کنید، گزارش ژرف است.",
    addressLabel: "نشانی",
    referenceLabel: "شمارهٔ مرجع",
    font: "Vazirmatn",
    special: "گچپژۀ",
  },
  ps: {
    sentence: "دا لیک د استوګنې په اړه دی. ټول سندونه تر ۱۴ مارچ ۲۰۲۷ مخکې ولېږئ. ډېر ښه، ګڼ شمېر ټاټوبي، ړومبی ږمه او ښځه ډاډه اوسئ.",
    addressLabel: "پته",
    referenceLabel: "د مرجع شمېره",
    font: "Vazirmatn",
    special: "ټډړږښګڼ",
  },
  ur: {
    sentence: "یہ خط آپ کی رہائش کے بارے میں ہے۔ براہ کرم ۱۴ مارچ ۲۰۲۷ سے پہلے مطلوبہ کاغذات ڈاک سے بھیجیں۔",
    addressLabel: "پتہ",
    referenceLabel: "حوالہ نمبر",
    font: "Noto Sans Arabic",
  },
  uk: {
    sentence: "Ви маєте відповісти до префектури до 14 березня 2027 року та надіслати потрібні документи.",
    addressLabel: "Адреса",
    referenceLabel: "Номер справи",
    font: "Noto Sans",
  },
  ti: {
    sentence: "ቅድሚ 14 መጋቢት 2027 ንፕረፈክቱር መልሲ ክትህቡን እቶም ዝተጠየቑ ዛዕባታት ክትሰዱን ኣለኩም።",
    addressLabel: "ኣድራሻ",
    referenceLabel: "ቁጽሪ መወከሲ",
    font: "Noto Sans Ethiopic",
  },
  so: {
    sentence: "Waa inaad jawaab u dirtaa maamulka gobolka kahor 14 Maarso 2027, adigoo soo diraya warqadaha loo baahan yahay.",
    addressLabel: "Cinwaanka",
    referenceLabel: "Lambarka tixraaca",
    font: "Noto Sans",
  },
  am: {
    sentence: "ከመጋቢት 14 ቀን 2027 በፊት ለፕሪፌክቱሩ መልስ መስጠት እና የተጠየቁትን ሰነዶች መላክ አለብዎት።",
    addressLabel: "አድራሻ",
    referenceLabel: "የማጣቀሻ ቁጥር",
    font: "Noto Sans Ethiopic",
  },
  // — added 2026-11 —
  ru: {
    sentence: "Вы должны ответить в префектуру до 14 марта 2027 года и отправить запрошенные документы.",
    addressLabel: "Адрес",
    referenceLabel: "Номер дела",
    font: "Noto Sans",
  },
  es: {
    sentence: "Debe responder a la prefectura antes del 14 de marzo de 2027 y enviar los documentos solicitados.",
    addressLabel: "Dirección",
    referenceLabel: "Referencia",
    font: "Noto Sans",
  },
  pt: {
    sentence: "Tem de responder à prefeitura antes de 14 de março de 2027 e enviar os documentos pedidos.",
    addressLabel: "Morada",
    referenceLabel: "Referência",
    font: "Noto Sans",
  },
  tr: {
    sentence: "14 Mart 2027 tarihinden önce valiliğe yanıt vermeniz ve istenen belgeleri göndermeniz gerekiyor.",
    addressLabel: "Adres",
    referenceLabel: "Başvuru numarası",
    font: "Noto Sans",
  },
  ku: {
    sentence: "Pêdivî ye hûn berî 14ê Adara 2027an bersiva wilayetê bidin û belgeyên xwestî bişînin.",
    addressLabel: "Navnîşan",
    referenceLabel: "Hejmara referansê",
    font: "Noto Sans",
    special: "ê î û ş ç Ê Î Û Ş Ç",
  },
  ckb: {
    sentence: "ئەم نامەیە لە پارێزگاوە هاتووە. پێویستە تا ١٤ی ئازاری ٢٠٢٧ وەڵام بدەیتەوە و بەڵگەنامە داواکراوەکان بنێریت.",
    addressLabel: "ناونیشان",
    referenceLabel: "ژمارەی سەرچاوە",
    font: "Noto Sans Arabic",
    special: "ڕڵۆێە",
  },
  bn: {
    sentence: "আপনাকে ১৪ মার্চ ২০২৭-এর আগে প্রিফেকচারকে উত্তর দিতে হবে এবং চাওয়া কাগজপত্র পাঠাতে হবে।",
    addressLabel: "ঠিকানা",
    referenceLabel: "রেফারেন্স নম্বর",
    font: "Noto Sans Bengali",
  },
  ta: {
    sentence: "14 மார்ச் 2027க்கு முன் நீங்கள் மாகாண அலுவலகத்துக்குப் பதிலளித்து, கேட்கப்பட்ட ஆவணங்களை அனுப்ப வேண்டும்.",
    addressLabel: "முகவரி",
    referenceLabel: "குறிப்பு எண்",
    font: "Noto Sans Tamil",
  },
  ka: {
    sentence: "თქვენ უნდა უპასუხოთ პრეფექტურას 2027 წლის 14 მარტამდე და გაგზავნოთ მოთხოვნილი დოკუმენტები.",
    addressLabel: "მისამართი",
    referenceLabel: "საცნობარო ნომერი",
    font: "Noto Sans Georgian",
  },
  hy: {
    sentence: "Դուք պետք է մինչև 2027 թվականի մարտի 14-ը պատասխանեք պրեֆեկտուրային և ուղարկեք պահանջված փաստաթղթերը։",
    addressLabel: "Հասցե",
    referenceLabel: "Տեղեկանքի համար",
    font: "Noto Sans Armenian",
  },
  sq: {
    sentence: "Duhet t'i përgjigjeni prefekturës para 14 marsit 2027 dhe të dërgoni dokumentet e kërkuara.",
    addressLabel: "Adresa",
    referenceLabel: "Referenca",
    font: "Noto Sans",
    special: "ë ç Ë Ç",
  },
  ro: {
    sentence: "Trebuie să răspundeți prefecturii înainte de 14 martie 2027 și să trimiteți documentele cerute.",
    addressLabel: "Adresa",
    referenceLabel: "Referința",
    font: "Noto Sans",
    special: "ă â î ș ț",
  },
  ht: {
    sentence: "Ou dwe reponn prefekti a anvan 14 mas 2027 epi voye dokiman yo mande yo.",
    addressLabel: "Adrès",
    referenceLabel: "Nimewo referans",
    font: "Noto Sans",
    special: "è ò",
  },
  wo: {
    sentence: "War nga tontu prefektiir bi balaa 14 Mars 2027 te yónnee kayit yi ñu laaj.",
    addressLabel: "Adres",
    referenceLabel: "Nimero referaas",
    font: "Noto Sans",
    special: "ŋ ñ ë à é ó",
  },
  ff: {
    sentence: "Ina haani ma jaabugo prefektiir adinaa 14 Maaris 2027 e neldugo dokimaaji ɗi ɗaɓɓitaaɗi.",
    addressLabel: "Ɗaɓɓitirgol wuro",
    referenceLabel: "Limngal ƴamol",
    font: "Noto Sans",
    special: "ɓ ɗ ŋ ƴ ñ Ɓ Ɗ Ŋ Ƴ",
  },
  bm: {
    sentence: "I ka kan ka jaabi di prefɛkitiri ma sani Marisikalo tile 14, 2027 ka sɛbɛnw ɲininkalenw ci.",
    addressLabel: "Adirɛsi",
    referenceLabel: "Nɔmɔrɔ jateminɛ",
    font: "Noto Sans",
    special: "ɛ ɔ ɲ ŋ Ɛ Ɔ Ɲ Ŋ",
  },
  ln: {
    sentence: "Osengeli koyanola prefɛkitiri liboso ya 14 na sanza ya Mars 2027 mpe kotinda mikanda esengami.",
    addressLabel: "Adrese",
    referenceLabel: "Motango ya referɛnse",
    font: "Noto Sans",
    special: "ɛ ɔ é ó Ɛ Ɔ",
  },
  sw: {
    sentence: "Unapaswa kujibu prefekitura kabla ya tarehe 14 Machi 2027 na kutuma hati zilizoombwa.",
    addressLabel: "Anwani",
    referenceLabel: "Nambari ya kumbukumbu",
    font: "Noto Sans",
  },
};

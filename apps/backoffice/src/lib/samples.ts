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
};

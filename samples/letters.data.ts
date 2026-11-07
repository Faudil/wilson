// Source of truth for the synthetic sample letters. All names, addresses and numbers are invented.
// Run `bun samples/build.ts` (writes .md/.html/.expected.json) then `bun samples/render.ts` (writes .png).
import type { LetterAnalysis, LetterText } from "@wilson/contracts";

export interface LetterDef {
  slug: string;
  /** Letterhead lines (first = organisation name). */
  letterhead: string[];
  refs: string[];
  /** "Valmont, le 3 novembre 2026" */
  place: string;
  recipient: string[];
  subject: string;
  /** Paragraphs. A line starting with "- " is a bullet. */
  body: string[];
  signature: string[];
  footer?: string;
  facts: Omit<LetterAnalysis, "promptVersion" | "fr" | "target">;
  fr: LetterText;
  en: LetterText;
  ar: LetterText;
  fa?: LetterText;
}

const P = "Préfecture de Valmont";

export const LETTERS: LetterDef[] = [
  {
    slug: "01-prefecture-convocation-titre-sejour",
    letterhead: [P, "Direction de l'immigration et de l'intégration", "Bureau du séjour des étrangers"],
    refs: ["N° étranger : 9900 1234 56", "Réf. dossier : VAL-2026-04817"],
    place: "Valmont, le 3 novembre 2026",
    recipient: ["Monsieur Samir BENALI", "12 rue des Acacias", "Appartement 4", "99000 VALMONT"],
    subject: "Convocation - demande de titre de séjour",
    body: [
      "Monsieur,",
      "Votre demande de titre de séjour est en cours d'instruction. Pour la poursuite de votre dossier, vous êtes convoqué(e) le 8 décembre 2026 à 9h30 au guichet 6 de la préfecture, 1 place de la République, 99000 Valmont.",
      "Vous devrez vous présenter avec les originaux des documents suivants :",
      "- votre passeport ou tout document d'identité en cours de validité ;",
      "- votre récépissé de demande de titre de séjour ;",
      "- un justificatif de domicile de moins de 3 mois ;",
      "- 3 photographies d'identité récentes.",
      "En cas d'empêchement, vous devez en informer le bureau du séjour avant la date de convocation. L'absence à ce rendez-vous sans motif valable peut retarder l'examen de votre dossier.",
      "Veuillez agréer, Monsieur, l'expression de mes salutations distinguées.",
    ],
    signature: ["Pour le préfet,", "La cheffe de bureau", "Claire DUVAL"],
    footer: "Accueil du public : du lundi au vendredi, de 8h30 à 12h00. Tél. 01 00 00 00 11 (appel non surtaxé).",
    facts: {
      isOfficialLetter: true,
      letterType: "prefecture_residence_permit",
      issuer: "Préfecture de Valmont",
      references: ["N° étranger : 9900 1234 56", "VAL-2026-04817"],
      letterDate: "2026-11-03",
      deadline: { date: "2026-12-08", kind: "appointment", explicit: true, sourceQuote: "vous êtes convoqué(e) le 8 décembre 2026 à 9h30" },
      urgency: "medium",
      confidence: 0.95,
      reviewerWarnings: [],
    },
    fr: {
      title: "La préfecture vous convoque à un rendez-vous pour votre demande de titre de séjour.",
      summary:
        "La préfecture traite votre demande de titre de séjour. Elle vous demande de venir à un rendez-vous le 8 décembre 2026 à 9h30, au guichet 6. Il faut apporter des documents originaux. Si vous ne pouvez pas venir, il faut prévenir la préfecture avant. Si vous ne venez pas, votre dossier peut prendre du retard.",
      actions: [
        "Notez le rendez-vous : 8 décembre 2026 à 9h30, préfecture de Valmont, guichet 6.",
        "Préparez les originaux : passeport ou pièce d'identité, récépissé, justificatif de domicile de moins de 3 mois, 3 photos d'identité.",
        "Si vous ne pouvez pas venir, prévenez le bureau du séjour avant la date.",
      ],
      orientation: [
        "L'association peut vous aider à préparer vos documents avant le rendez-vous.",
        "Pour changer la date, contactez le bureau du séjour de la préfecture (numéro sur la lettre).",
      ],
    },
    en: {
      title: "The prefecture has invited you to an appointment about your residence permit application.",
      summary:
        "The prefecture is working on your residence permit application. It asks you to come to an appointment on 8 December 2026 at 9:30, at desk 6. You must bring original documents. If you cannot come, you must tell the prefecture before that date. If you do not come, your file can be delayed.",
      actions: [
        "Write down the appointment: 8 December 2026 at 9:30, Préfecture de Valmont, desk 6.",
        "Prepare the originals: passport or ID, your récépissé, proof of address less than 3 months old, 3 passport photos.",
        "If you cannot come, tell the prefecture's residence office before the date.",
      ],
      orientation: [
        "The association can help you prepare your documents before the appointment.",
        "To change the date, contact the residence office of the prefecture (number on the letter).",
      ],
    },
    ar: {
      title: "تدعوك المحافظة إلى موعد بخصوص طلب بطاقة الإقامة.",
      summary:
        "المحافظة تدرس طلب بطاقة الإقامة الخاص بك. تطلب منك الحضور إلى موعد يوم 8 ديسمبر 2026 الساعة 9:30 عند الشباك رقم 6. يجب أن تحضر الوثائق الأصلية. إذا لم تستطع الحضور، يجب أن تخبر المحافظة قبل هذا التاريخ. إذا لم تحضر، قد يتأخر ملفك.",
      actions: [
        "سجّل الموعد: 8 ديسمبر 2026 الساعة 9:30، Préfecture de Valmont، الشباك 6.",
        "جهّز الوثائق الأصلية: جواز السفر أو بطاقة الهوية، الوصل (récépissé)، إثبات السكن لا يزيد عمره عن 3 أشهر، 3 صور شخصية.",
        "إذا لم تستطع الحضور، أخبر مكتب الإقامة في المحافظة قبل التاريخ.",
      ],
      orientation: [
        "يمكن للجمعية أن تساعدك في تجهيز وثائقك قبل الموعد.",
        "لتغيير الموعد، اتصل بمكتب الإقامة في المحافظة (الرقم مكتوب على الرسالة).",
      ],
    },
    fa: {
      title: "ولایت شما را برای وقت ملاقات درباره درخواست اجازه اقامت دعوت کرده است.",
      summary:
        "ولایت درخواست اجازه اقامت شما را بررسی می‌کند. از شما می‌خواهد که در ۸ دسامبر ۲۰۲۶ ساعت ۹:۳۰ به کانتر شماره ۶ بیایید. باید اسناد اصلی را با خود بیاورید. اگر نمی‌توانید بیایید، باید پیش از آن تاریخ به ولایت خبر بدهید. اگر نیایید، پرونده شما ممکن است دیر شود.",
      actions: [
        "وقت ملاقات را یادداشت کنید: ۸ دسامبر ۲۰۲۶ ساعت ۹:۳۰، Préfecture de Valmont، کانتر ۶.",
        "اسناد اصلی را آماده کنید: پاسپورت یا کارت هویت، رسید (récépissé)، سند آدرس کمتر از ۳ ماه، ۳ عکس.",
        "اگر نمی‌توانید بیایید، پیش از آن تاریخ به دفتر اقامت ولایت خبر بدهید.",
      ],
      orientation: [
        "انجمن می‌تواند در آماده کردن اسناد پیش از ملاقات به شما کمک کند.",
        "برای تغییر تاریخ، با دفتر اقامت ولایت تماس بگیرید (شماره در نامه است).",
      ],
    },
  },
  {
    slug: "02-prefecture-oqtf",
    letterhead: [P, "Direction de l'immigration et de l'intégration", "Bureau de l'éloignement"],
    refs: ["N° étranger : 9900 7777 12", "Arrêté n° 2026-OQTF-0931"],
    place: "Valmont, le 2 novembre 2026",
    recipient: ["Madame Layla RAHIMI", "Hébergement d'urgence Les Tilleuls", "8 allée des Peupliers", "99000 VALMONT"],
    subject: "Notification d'une obligation de quitter le territoire français",
    body: [
      "Madame,",
      "Par arrêté du 2 novembre 2026, le préfet de Valmont a refusé de vous délivrer un titre de séjour et vous a fait obligation de quitter le territoire français. Cet arrêté vous est notifié ce jour.",
      "Vous devez quitter le territoire français dans un délai de trente jours à compter de la notification du présent arrêté.",
      "Voies et délais de recours : vous pouvez contester cet arrêté devant le tribunal administratif de Valmont, 5 rue du Palais, 99000 Valmont, dans un délai de trente jours à compter de sa notification. Le recours doit être déposé par écrit. Vous pouvez vous rapprocher d'un avocat ou d'une association.",
      "Si vous ne quittez pas le territoire dans le délai indiqué, vous vous exposez à des mesures d'éloignement d'office.",
      "Veuillez agréer, Madame, l'expression de mes salutations distinguées.",
    ],
    signature: ["Pour le préfet,", "Le chef du bureau de l'éloignement", "Marc LEFEBVRE"],
    footer: "Notifié le 2 novembre 2026 - Signature de l'intéressée : ______________________",
    facts: {
      isOfficialLetter: true,
      letterType: "prefecture_removal_order",
      issuer: "Préfecture de Valmont",
      references: ["N° étranger : 9900 7777 12", "Arrêté n° 2026-OQTF-0931"],
      letterDate: "2026-11-02",
      deadline: {
        date: "2026-12-02",
        kind: "appeal",
        explicit: false,
        sourceQuote: "dans un délai de trente jours à compter de sa notification",
      },
      urgency: "high",
      confidence: 0.93,
      reviewerWarnings: [
        "Obligation de quitter le territoire (OQTF) : un délai légal de recours est en jeu, à faire vérifier par un juriste ou une association.",
        "La date limite du 2 décembre 2026 est calculée (30 jours à partir de la notification du 2 novembre 2026), elle n'est pas imprimée : à vérifier sur la lettre.",
      ],
    },
    fr: {
      title: "La préfecture vous demande de quitter le territoire français (OQTF). C'est urgent.",
      summary:
        "La préfecture a refusé votre demande de titre de séjour. Elle écrit que vous devez quitter la France dans un délai de trente jours après la remise de cette lettre. La lettre dit aussi que vous pouvez faire un recours écrit devant le tribunal administratif, dans un délai de trente jours. Cette lettre est très importante. Il faut en parler vite à l'association ou à un avocat.",
      actions: [
        "Allez vite à l'association ou voyez un avocat, avec cette lettre.",
        "Gardez la lettre et l'enveloppe. Notez la date où vous l'avez reçue : 2 novembre 2026.",
        "Apportez aussi vos autres papiers (récépissé, convocations, décisions).",
      ],
      orientation: [
        "Allez très vite à l'association ou chez un avocat pour parler de cette lettre. L'association peut vous aider à trouver un avocat.",
        "Le tribunal administratif de Valmont, 5 rue du Palais, est indiqué sur la lettre pour les recours.",
      ],
    },
    en: {
      title: "The prefecture orders you to leave French territory (OQTF). This is urgent.",
      summary:
        "The prefecture has refused your residence permit application. It writes that you must leave France within thirty days after you received this letter. The letter also says that you can make a written appeal to the administrative court, within thirty days. This letter is very important. You need to talk about it quickly with the association or a lawyer.",
      actions: [
        "Go quickly to the association or see a lawyer, with this letter.",
        "Keep the letter and the envelope. Write down the date you received it: 2 November 2026.",
        "Bring your other papers too (récépissé, appointment letters, decisions).",
      ],
      orientation: [
        "Go very quickly to the association or to a lawyer to talk about this letter. The association can help you find a lawyer.",
        "The letter names the administrative court of Valmont, 5 rue du Palais, for appeals.",
      ],
    },
    ar: {
      title: "تطلب منك المحافظة مغادرة الأراضي الفرنسية (OQTF). هذا الأمر عاجل.",
      summary:
        "رفضت المحافظة طلب بطاقة الإقامة الخاص بك. تكتب أنه يجب عليك مغادرة فرنسا خلال ثلاثين يومًا بعد استلام هذه الرسالة. وتقول الرسالة أيضًا إنه يمكنك تقديم طعن مكتوب أمام المحكمة الإدارية خلال ثلاثين يومًا. هذه الرسالة مهمة جدًا. يجب أن تتحدث عنها بسرعة مع الجمعية أو مع محامٍ.",
      actions: [
        "اذهب بسرعة إلى الجمعية أو قابل محاميًا ومعك هذه الرسالة.",
        "احتفظ بالرسالة والظرف. اكتب تاريخ استلامها: 2 نوفمبر 2026.",
        "أحضر أيضًا أوراقك الأخرى (الوصل، رسائل المواعيد، القرارات).",
      ],
      orientation: [
        "اذهب بسرعة كبيرة إلى الجمعية أو إلى محامٍ للحديث عن هذه الرسالة. يمكن للجمعية أن تساعدك في إيجاد محامٍ.",
        "تذكر الرسالة المحكمة الإدارية في Valmont، 5 rue du Palais، لتقديم الطعون.",
      ],
    },
  },
  {
    slug: "03-ofpra-convocation-entretien",
    letterhead: ["Office français de protection des réfugiés et apatrides (OFPRA)", "Division de l'instruction", "10 avenue des Tilleuls, 99100 Exempleville"],
    refs: ["N° OFPRA : 26012345", "N° étranger : 9900 5555 08"],
    place: "Exempleville, le 30 octobre 2026",
    recipient: ["Monsieur Yusuf AHMADI", "Centre d'accueil Les Cèdres", "3 chemin du Moulin", "99000 VALMONT"],
    subject: "Convocation à un entretien à l'OFPRA",
    body: [
      "Monsieur,",
      "Dans le cadre de l'examen de votre demande d'asile, vous êtes convoqué(e) à un entretien personnel le 24 novembre 2026 à 10h00 dans nos locaux, 10 avenue des Tilleuls, 99100 Exempleville.",
      "Cet entretien est individuel. Un interprète dans la langue que vous avez indiquée sera présent. Vous pouvez être accompagné d'un avocat ou d'un représentant d'une association habilitée.",
      "Merci de vous munir de cette convocation et de votre attestation de demande d'asile.",
      "Si vous êtes dans l'impossibilité de vous présenter, vous devez nous écrire sans délai en indiquant un motif sérieux et en joignant un justificatif. Votre demande de report sera examinée au cas par cas.",
      "Veuillez agréer, Monsieur, l'expression de mes salutations distinguées.",
    ],
    signature: ["L'officier de protection", "Service des convocations"],
    footer: "Le trajet peut être pris en charge sur demande. Voir le formulaire joint.",
    facts: {
      isOfficialLetter: true,
      letterType: "ofpra_convocation",
      issuer: "OFPRA",
      references: ["N° OFPRA : 26012345", "N° étranger : 9900 5555 08"],
      letterDate: "2026-10-30",
      deadline: { date: "2026-11-24", kind: "appointment", explicit: true, sourceQuote: "vous êtes convoqué(e) à un entretien personnel le 24 novembre 2026 à 10h00" },
      urgency: "medium",
      confidence: 0.96,
      reviewerWarnings: [],
    },
    fr: {
      title: "L'OFPRA vous convoque à un entretien pour votre demande d'asile.",
      summary:
        "L'OFPRA examine votre demande d'asile. Il vous demande de venir à un entretien le 24 novembre 2026 à 10h00. L'entretien est seul avec un officier de protection. Il y aura un interprète. Vous pouvez venir avec un avocat ou une personne d'une association habilitée. Si vous ne pouvez pas venir, il faut écrire tout de suite à l'OFPRA avec une raison sérieuse et un justificatif.",
      actions: [
        "Notez l'entretien : 24 novembre 2026 à 10h00, OFPRA, 10 avenue des Tilleuls.",
        "Apportez la convocation et votre attestation de demande d'asile.",
        "Contactez l'association pour préparer l'entretien et savoir si quelqu'un peut vous accompagner.",
        "Si vous ne pouvez pas venir, écrivez tout de suite à l'OFPRA.",
      ],
      orientation: [
        "L'association peut vous aider à vous préparer et à prévoir qui vous accompagne.",
        "Pour un avocat, parlez-en vite à l'association.",
      ],
    },
    en: {
      title: "OFPRA invites you to an interview about your asylum application.",
      summary:
        "OFPRA is examining your asylum application. It asks you to come to an interview on 24 November 2026 at 10:00. You will be alone with a protection officer. There will be an interpreter. You can come with a lawyer or a person from an approved association. If you cannot come, you must write to OFPRA immediately with a serious reason and a proof.",
      actions: [
        "Write down the interview: 24 November 2026 at 10:00, OFPRA, 10 avenue des Tilleuls.",
        "Bring the invitation letter and your asylum application certificate.",
        "Contact the association to prepare the interview and see if someone can come with you.",
        "If you cannot come, write to OFPRA immediately.",
      ],
      orientation: [
        "The association can help you prepare and organise who comes with you.",
        "If you want a lawyer, talk to the association quickly.",
      ],
    },
    ar: {
      title: "تدعوك OFPRA إلى مقابلة بخصوص طلب اللجوء.",
      summary:
        "تدرس OFPRA طلب اللجوء الخاص بك. تطلب منك الحضور إلى مقابلة يوم 24 نوفمبر 2026 الساعة 10:00. ستكون المقابلة بينك وبين موظف حماية فقط. سيكون هناك مترجم. يمكنك الحضور مع محامٍ أو مع شخص من جمعية معتمدة. إذا لم تستطع الحضور، يجب أن تكتب فورًا إلى OFPRA مع سبب جدي ووثيقة تثبته.",
      actions: [
        "سجّل المقابلة: 24 نوفمبر 2026 الساعة 10:00، OFPRA، 10 avenue des Tilleuls.",
        "أحضر رسالة الدعوة وشهادة طلب اللجوء.",
        "اتصل بالجمعية لتحضير المقابلة ومعرفة إن كان يمكن لشخص مرافقتك.",
        "إذا لم تستطع الحضور، اكتب فورًا إلى OFPRA.",
      ],
      orientation: [
        "يمكن للجمعية أن تساعدك في الاستعداد وفي ترتيب من يرافقك.",
        "إذا أردت محاميًا، تحدث مع الجمعية بسرعة.",
      ],
    },
  },
  {
    slug: "04-ofpra-rejet-cnda",
    letterhead: ["Office français de protection des réfugiés et apatrides (OFPRA)", "Division de l'asile", "10 avenue des Tilleuls, 99100 Exempleville"],
    refs: ["N° OFPRA : 26009876", "Décision n° 2026-D-5521"],
    place: "Exempleville, le 28 octobre 2026",
    recipient: ["Monsieur Daniel TESFAY", "Foyer Saint-Michel", "21 rue Victor Hugo", "99000 VALMONT"],
    subject: "Décision de rejet de votre demande d'asile",
    body: [
      "Monsieur,",
      "J'ai l'honneur de vous informer que, après examen de votre demande, le directeur général de l'OFPRA a décidé de rejeter votre demande d'asile. Les motifs de la décision sont exposés dans le document joint.",
      "Cette décision vous est notifiée par lettre recommandée avec accusé de réception, datée du 28 octobre 2026.",
      "Voies et délais de recours : vous pouvez contester cette décision en saisissant la Cour nationale du droit d'asile (CNDA), 35 rue du Tribunal, 99200 Exempleville, dans le délai d'un mois à compter de la notification de la présente décision. Le recours doit être écrit, rédigé en français et signé. Vous pouvez demander l'aide juridictionnelle.",
      "À défaut de recours dans ce délai, la décision deviendra définitive.",
      "Veuillez agréer, Monsieur, l'expression de mes salutations distinguées.",
    ],
    signature: ["Pour le directeur général,", "La cheffe de division", "Hélène MARCHAND"],
    footer: "Décision notifiée par LRAR - accusé de réception à retourner à l'OFPRA.",
    facts: {
      isOfficialLetter: true,
      letterType: "ofpra_decision",
      issuer: "OFPRA",
      references: ["N° OFPRA : 26009876", "Décision n° 2026-D-5521"],
      letterDate: "2026-10-28",
      deadline: {
        date: "2026-11-28",
        kind: "appeal",
        explicit: false,
        sourceQuote: "dans le délai d'un mois à compter de la notification de la présente décision",
      },
      urgency: "high",
      confidence: 0.92,
      reviewerWarnings: [
        "Rejet OFPRA : un délai légal de recours devant la CNDA est en jeu, à faire vérifier d'urgence par un juriste ou une association.",
        "La date du 28 novembre 2026 est calculée (un mois à partir de la notification), elle n'est pas imprimée ; la date de remise réelle du courrier recommandé peut différer. À vérifier.",
      ],
    },
    fr: {
      title: "L'OFPRA a rejeté votre demande d'asile. C'est urgent.",
      summary:
        "L'OFPRA a décidé de rejeter votre demande d'asile. Les raisons sont écrites dans le document joint à la lettre. La lettre dit que vous pouvez faire un recours devant la Cour nationale du droit d'asile (CNDA), dans un délai d'un mois après la notification. Le recours doit être écrit en français et signé. Cette lettre est très importante. Il faut en parler vite à l'association ou à un avocat.",
      actions: [
        "Allez vite à l'association ou voyez un avocat, avec la lettre et le document joint.",
        "Gardez la lettre recommandée et notez la date de réception.",
        "Demandez à l'association ou à l'avocat comment obtenir l'aide juridictionnelle (aide pour payer un avocat).",
      ],
      orientation: [
        "Allez très vite à l'association ou chez un avocat pour parler de cette décision. L'association peut vous aider à trouver un avocat.",
        "La lettre indique la CNDA, 35 rue du Tribunal, 99200 Exempleville, pour les recours.",
      ],
    },
    en: {
      title: "OFPRA has rejected your asylum application. This is urgent.",
      summary:
        "OFPRA has decided to reject your asylum application. The reasons are written in the document attached to the letter. The letter says that you can make an appeal to the National Court of Asylum (CNDA), within one month after notification. The appeal must be written in French and signed. This letter is very important. You need to talk about it quickly with the association or a lawyer.",
      actions: [
        "Go quickly to the association or see a lawyer, with the letter and the attached document.",
        "Keep the registered letter and write down the date you received it.",
        "Ask the association or the lawyer how to get legal aid (help to pay a lawyer).",
      ],
      orientation: [
        "Go very quickly to the association or to a lawyer to talk about this decision. The association can help you find a lawyer.",
        "The letter names the CNDA, 35 rue du Tribunal, 99200 Exempleville, for appeals.",
      ],
    },
    ar: {
      title: "رفضت OFPRA طلب اللجوء الخاص بك. هذا الأمر عاجل.",
      summary:
        "قررت OFPRA رفض طلب اللجوء الخاص بك. الأسباب مكتوبة في الوثيقة المرفقة بالرسالة. تقول الرسالة إنه يمكنك تقديم طعن أمام المحكمة الوطنية لحق اللجوء (CNDA) خلال شهر واحد بعد التبليغ. يجب أن يكون الطعن مكتوبًا بالفرنسية وموقّعًا. هذه الرسالة مهمة جدًا. يجب أن تتحدث عنها بسرعة مع الجمعية أو مع محامٍ.",
      actions: [
        "اذهب بسرعة إلى الجمعية أو قابل محاميًا ومعك الرسالة والوثيقة المرفقة.",
        "احتفظ بالرسالة المسجلة واكتب تاريخ استلامها.",
        "اسأل الجمعية أو المحامي كيف تحصل على المساعدة القضائية (مساعدة لدفع أتعاب المحامي).",
      ],
      orientation: [
        "اذهب بسرعة كبيرة إلى الجمعية أو إلى محامٍ للحديث عن هذا القرار. يمكن للجمعية أن تساعدك في إيجاد محامٍ.",
        "تذكر الرسالة CNDA، 35 rue du Tribunal، 99200 Exempleville، لتقديم الطعون.",
      ],
    },
  },
  {
    slug: "05-caf-demande-pieces",
    letterhead: ["Caisse d'allocations familiales de Valmont", "Service des prestations", "BP 100, 99001 Valmont Cedex"],
    refs: ["N° allocataire : 1234567", "Courrier n° 2026/11/0458"],
    place: "Valmont, le 31 octobre 2026",
    recipient: ["Madame Fatima NOURI", "17 boulevard Pasteur", "Bâtiment B", "99000 VALMONT"],
    subject: "Demande de pièces justificatives",
    body: [
      "Madame,",
      "Pour poursuivre l'examen de votre droit aux prestations, nous avons besoin des documents suivants :",
      "- votre titre de séjour ou récépissé en cours de validité ;",
      "- les trois derniers bulletins de salaire, ou une attestation sur l'honneur si vous n'avez pas de revenus ;",
      "- un relevé d'identité bancaire (RIB) à votre nom.",
      "Vous pouvez les déposer sur caf.example.fr (espace Mon Compte), ou les envoyer à l'adresse ci-dessus, avant le 20 novembre 2026.",
      "À défaut de réception de ces pièces dans ce délai, le versement de vos prestations pourra être suspendu.",
      "Pour toute question, appelez le 0 800 00 00 00 (service et appel gratuits) ou rendez-vous à l'accueil de la CAF.",
      "Cordialement,",
    ],
    signature: ["Le service gestion des droits"],
    footer: "Ne joignez pas d'originaux : envoyez des copies lisibles.",
    facts: {
      isOfficialLetter: true,
      letterType: "caf",
      issuer: "Caisse d'allocations familiales de Valmont",
      references: ["N° allocataire : 1234567", "2026/11/0458"],
      letterDate: "2026-10-31",
      deadline: { date: "2026-11-20", kind: "reply", explicit: true, sourceQuote: "avant le 20 novembre 2026" },
      urgency: "high",
      confidence: 0.95,
      reviewerWarnings: [],
    },
    fr: {
      title: "La CAF vous demande des documents avant le 20 novembre 2026.",
      summary:
        "La CAF vérifie votre droit aux aides. Elle vous demande trois choses : votre titre de séjour ou récépissé, vos trois derniers bulletins de salaire (ou une attestation sur l'honneur si vous n'avez pas de revenus), et un RIB à votre nom. Il faut les envoyer avant le 20 novembre 2026. Sinon, le paiement de vos aides peut être arrêté.",
      actions: [
        "Rassemblez : titre de séjour ou récépissé, 3 derniers bulletins de salaire (ou attestation sur l'honneur), RIB à votre nom.",
        "Faites des copies lisibles. N'envoyez pas les originaux.",
        "Envoyez-les à la CAF avant le 20 novembre 2026 (en ligne ou par courrier).",
      ],
      orientation: [
        "L'association peut vous aider à préparer les documents et à les envoyer en ligne.",
        "Pour une question sur le dossier, appelez la CAF au numéro gratuit de la lettre.",
      ],
    },
    en: {
      title: "The CAF asks you for documents before 20 November 2026.",
      summary:
        "The CAF is checking your right to benefits. It asks you for three things: your residence permit or récépissé, your last three payslips (or a statement on honour if you have no income), and a bank details slip (RIB) in your name. You must send them before 20 November 2026. If not, payment of your benefits can be stopped.",
      actions: [
        "Gather: residence permit or récépissé, last 3 payslips (or statement on honour), RIB in your name.",
        "Make clear copies. Do not send the originals.",
        "Send them to the CAF before 20 November 2026 (online or by post).",
      ],
      orientation: [
        "The association can help you prepare the documents and send them online.",
        "For a question about your file, call the CAF on the free number on the letter.",
      ],
    },
    ar: {
      title: "تطلب منك CAF وثائق قبل 20 نوفمبر 2026.",
      summary:
        "تتحقق CAF من حقك في المساعدات. تطلب منك ثلاثة أشياء: بطاقة الإقامة أو الوصل (récépissé)، وآخر ثلاث كشوف رواتب (أو تصريحًا بالشرف إذا لم يكن لديك دخل)، وكشف الهوية البنكية (RIB) باسمك. يجب إرسالها قبل 20 نوفمبر 2026. وإلا فقد يتوقف دفع مساعداتك.",
      actions: [
        "اجمع: بطاقة الإقامة أو الوصل، آخر 3 كشوف رواتب (أو تصريحًا بالشرف)، RIB باسمك.",
        "اصنع نسخًا واضحة. لا ترسل الأوراق الأصلية.",
        "أرسلها إلى CAF قبل 20 نوفمبر 2026 (عبر الإنترنت أو بالبريد).",
      ],
      orientation: [
        "يمكن للجمعية أن تساعدك في تجهيز الوثائق وإرسالها عبر الإنترنت.",
        "لأي سؤال عن ملفك، اتصل بـ CAF على الرقم المجاني المكتوب في الرسالة.",
      ],
    },
  },
  {
    slug: "06-ofii-ada-suspension",
    letterhead: ["Office français de l'immigration et de l'intégration (OFII)", "Direction territoriale de Valmont", "Service de l'asile", "4 rue Jean Jaurès, 99000 Valmont"],
    refs: ["N° OFII : 2026-VAL-30417", "N° étranger : 9900 3333 21"],
    place: "Valmont, le 4 novembre 2026",
    recipient: ["Monsieur Omar DIALLO", "Hôtel Le Relais", "Chambre 12", "99000 VALMONT"],
    subject: "Suspension de l'allocation pour demandeur d'asile (ADA)",
    body: [
      "Monsieur,",
      "Nous vous informons que le versement de votre allocation pour demandeur d'asile (ADA) est suspendu à compter du 1er novembre 2026, car vous ne vous êtes pas présenté(e) au rendez-vous du 20 octobre 2026 sans nous en avoir informés.",
      "Avant toute décision définitive de retrait, vous pouvez présenter vos observations écrites, accompagnées de justificatifs, avant le 23 novembre 2026, à l'adresse ci-dessus ou en vous présentant à l'accueil de la direction territoriale.",
      "À l'issue de ce délai, l'OFII pourra décider de rétablir l'allocation, de la retirer ou de la réduire.",
      "Veuillez agréer, Monsieur, l'expression de mes salutations distinguées.",
    ],
    signature: ["Le directeur territorial", "Pour l'OFII"],
    footer: "Accueil : lundi, mardi, jeudi et vendredi de 9h00 à 12h00.",
    facts: {
      isOfficialLetter: true,
      letterType: "ofii",
      issuer: "OFII - Direction territoriale de Valmont",
      references: ["N° OFII : 2026-VAL-30417", "N° étranger : 9900 3333 21"],
      letterDate: "2026-11-04",
      deadline: { date: "2026-11-23", kind: "reply", explicit: true, sourceQuote: "avant le 23 novembre 2026" },
      urgency: "high",
      confidence: 0.94,
      reviewerWarnings: [
        "Suspension de l'ADA : risque de perte de ressources, la personne doit être reçue rapidement par un bénévole.",
      ],
    },
    fr: {
      title: "L'OFII a arrêté de payer votre allocation (ADA). Vous pouvez répondre avant le 23 novembre 2026.",
      summary:
        "L'OFII a suspendu le paiement de votre allocation pour demandeur d'asile (ADA) depuis le 1er novembre 2026. La lettre dit que vous n'êtes pas venu au rendez-vous du 20 octobre 2026. Avant une décision finale, vous pouvez écrire vos explications et joindre des preuves, avant le 23 novembre 2026. Ensuite, l'OFII peut décider de payer de nouveau, de retirer ou de réduire l'allocation.",
      actions: [
        "Écrivez à l'OFII pour expliquer pourquoi vous n'êtes pas venu, avant le 23 novembre 2026.",
        "Joignez des preuves si vous en avez (papier du médecin, convocation, etc.).",
        "Déposez la réponse à l'accueil de l'OFII ou envoyez-la à l'adresse de la lettre. Gardez une copie.",
      ],
      orientation: [
        "Venez vite à l'association : un bénévole peut vous aider à écrire votre réponse.",
        "Pour une question sur l'allocation, contactez l'OFII de Valmont (adresse sur la lettre).",
      ],
    },
    en: {
      title: "OFII has stopped paying your allowance (ADA). You can reply before 23 November 2026.",
      summary:
        "OFII has suspended payment of your asylum seeker allowance (ADA) since 1 November 2026. The letter says you did not come to the appointment on 20 October 2026. Before a final decision, you can write your explanation and attach proof, before 23 November 2026. After that, OFII can decide to pay again, to withdraw or to reduce the allowance.",
      actions: [
        "Write to OFII to explain why you did not come, before 23 November 2026.",
        "Attach proof if you have some (doctor's paper, appointment letter, etc.).",
        "Hand your reply in at the OFII desk or send it to the address on the letter. Keep a copy.",
      ],
      orientation: [
        "Come quickly to the association: a volunteer can help you write your reply.",
        "For a question about the allowance, contact OFII Valmont (address on the letter).",
      ],
    },
    ar: {
      title: "أوقفت OFII دفع مساعدتك (ADA). يمكنك الرد قبل 23 نوفمبر 2026.",
      summary:
        "علّقت OFII دفع مساعدة طالب اللجوء (ADA) منذ 1 نوفمبر 2026. تقول الرسالة إنك لم تحضر موعد 20 أكتوبر 2026. قبل القرار النهائي، يمكنك كتابة توضيحاتك وإرفاق إثباتات، قبل 23 نوفمبر 2026. بعد ذلك يمكن لـ OFII أن تقرر الدفع من جديد أو سحب المساعدة أو تخفيضها.",
      actions: [
        "اكتب إلى OFII لتشرح لماذا لم تحضر، قبل 23 نوفمبر 2026.",
        "أرفق إثباتات إن وجدت (ورقة من الطبيب، رسالة موعد، إلخ).",
        "سلّم ردك في مكتب الاستقبال في OFII أو أرسله إلى العنوان المكتوب في الرسالة. احتفظ بنسخة.",
      ],
      orientation: [
        "تعال بسرعة إلى الجمعية: يمكن لمتطوع أن يساعدك في كتابة ردك.",
        "لأي سؤال عن المساعدة، اتصل بـ OFII Valmont (العنوان في الرسالة).",
      ],
    },
  },
  {
    slug: "07-cpam-ame-acceptation",
    letterhead: ["Caisse primaire d'assurance maladie de Valmont", "Aide médicale de l'État (AME)", "TSA 20000, 99002 Valmont Cedex"],
    refs: ["Dossier AME n° 2026-AME-77120"],
    place: "Valmont, le 29 octobre 2026",
    recipient: ["Madame Mariam KARIMI", "5 impasse des Lilas", "99000 VALMONT"],
    subject: "Notification d'admission à l'aide médicale de l'État",
    body: [
      "Madame,",
      "Nous avons le plaisir de vous informer que votre demande d'aide médicale de l'État (AME) a été acceptée. Vous bénéficiez de l'AME du 1er octobre 2026 au 30 septembre 2027.",
      "Votre attestation d'admission est jointe à ce courrier. Votre carte d'admission à l'AME vous sera envoyée dans un délai de 3 semaines. Elle vous permet d'être soignée sans avancer d'argent chez les professionnels de santé qui acceptent l'AME.",
      "Pensez à demander le renouvellement de votre droit deux mois avant son terme.",
      "Cordialement,",
    ],
    signature: ["Le service de l'AME"],
    footer: "Ameli.fr - 36 46 (service gratuit + prix d'un appel).",
    facts: {
      isOfficialLetter: true,
      letterType: "cpam",
      issuer: "CPAM de Valmont",
      references: ["Dossier AME n° 2026-AME-77120"],
      letterDate: "2026-10-29",
      deadline: null,
      urgency: "low",
      confidence: 0.96,
      reviewerWarnings: [],
    },
    fr: {
      title: "Bonne nouvelle : votre demande d'AME (aide médicale) est acceptée.",
      summary:
        "La CPAM a accepté votre demande d'aide médicale de l'État (AME). Vous avez ce droit du 1er octobre 2026 au 30 septembre 2027. Une attestation est jointe à la lettre. Votre carte arrive par courrier dans environ 3 semaines. Avec la carte, vous pouvez vous faire soigner sans avancer d'argent chez les professionnels qui acceptent l'AME. Il faudra demander le renouvellement deux mois avant la fin.",
      actions: [
        "Gardez l'attestation jointe avec vos papiers importants.",
        "Attendez la carte AME par courrier (environ 3 semaines).",
        "Notez de demander le renouvellement deux mois avant le 30 septembre 2027.",
      ],
      orientation: [
        "L'association peut vous aider à préparer le renouvellement de l'AME.",
        "Pour une question sur votre dossier, contactez la CPAM de Valmont (coordonnées sur la lettre).",
      ],
    },
    en: {
      title: "Good news: your AME (medical aid) application has been accepted.",
      summary:
        "The CPAM has accepted your State Medical Aid (AME) application. You have this right from 1 October 2026 to 30 September 2027. A certificate is attached to the letter. Your card will arrive by post in about 3 weeks. With the card, you can get care without paying in advance from professionals who accept AME. You will need to ask for renewal two months before the end.",
      actions: [
        "Keep the attached certificate with your important papers.",
        "Wait for the AME card by post (about 3 weeks).",
        "Note to ask for renewal two months before 30 September 2027.",
      ],
      orientation: [
        "The association can help you prepare the AME renewal.",
        "For a question about your file, contact the CPAM of Valmont (details on the letter).",
      ],
    },
    ar: {
      title: "خبر سار: تمت الموافقة على طلب AME (المساعدة الطبية) الخاص بك.",
      summary:
        "وافقت CPAM على طلب المساعدة الطبية من الدولة (AME) الخاص بك. لديك هذا الحق من 1 أكتوبر 2026 إلى 30 سبتمبر 2027. شهادة مرفقة بالرسالة. ستصلك بطاقتك بالبريد خلال 3 أسابيع تقريبًا. بالبطاقة يمكنك العلاج دون دفع مسبق عند المهنيين الذين يقبلون AME. يجب أن تطلب التجديد قبل شهرين من النهاية.",
      actions: [
        "احتفظ بالشهادة المرفقة مع أوراقك المهمة.",
        "انتظر بطاقة AME بالبريد (حوالي 3 أسابيع).",
        "سجّل أن تطلب التجديد قبل شهرين من 30 سبتمبر 2027.",
      ],
      orientation: [
        "يمكن للجمعية أن تساعدك في تحضير تجديد AME.",
        "لأي سؤال عن ملفك، اتصل بـ CPAM de Valmont (البيانات في الرسالة).",
      ],
    },
  },
  {
    slug: "08-france-travail-rdv",
    letterhead: ["France Travail", "Agence de Valmont-Centre", "20 avenue de la Gare, 99000 Valmont"],
    refs: ["Identifiant : 9876543X", "Courrier n° FT-2026-88231"],
    place: "Valmont, le 2 novembre 2026",
    recipient: ["Monsieur Ibrahim SESAY", "9 rue du Lavoir", "99000 VALMONT"],
    subject: "Convocation à un entretien de suivi",
    body: [
      "Monsieur,",
      "Votre conseiller vous convoque à un entretien de suivi et d'actualisation de votre projet professionnel le 25 novembre 2026 à 14h00, à l'agence de Valmont-Centre, 20 avenue de la Gare (bureau 3).",
      "Merci de vous munir de votre titre de séjour autorisant à travailler, de votre CV à jour et, si vous en avez, de vos attestations de formation.",
      "Votre présence est obligatoire. En cas d'absence non justifiée, vous pouvez être radié(e) de la liste des demandeurs d'emploi. Si vous ne pouvez pas venir, contactez-nous avant le rendez-vous par votre espace personnel ou au 39 49.",
      "Cordialement,",
    ],
    signature: ["Votre conseiller France Travail", "Nadia PERRIN"],
    footer: "Accueil sur rendez-vous du lundi au vendredi.",
    facts: {
      isOfficialLetter: true,
      letterType: "france_travail",
      issuer: "France Travail - Agence de Valmont-Centre",
      references: ["Identifiant : 9876543X", "FT-2026-88231"],
      letterDate: "2026-11-02",
      deadline: { date: "2026-11-25", kind: "appointment", explicit: true, sourceQuote: "le 25 novembre 2026 à 14h00" },
      urgency: "medium",
      confidence: 0.95,
      reviewerWarnings: [],
    },
    fr: {
      title: "France Travail vous convoque à un entretien le 25 novembre 2026.",
      summary:
        "Votre conseiller France Travail vous demande de venir à un entretien le 25 novembre 2026 à 14h00, au bureau 3 de l'agence de Valmont-Centre. Il faut apporter votre titre de séjour qui autorise à travailler et votre CV. La présence est obligatoire. Si vous ne venez pas sans raison, vous pouvez être radié de la liste des demandeurs d'emploi. Si vous ne pouvez pas venir, il faut prévenir avant le rendez-vous.",
      actions: [
        "Notez le rendez-vous : 25 novembre 2026 à 14h00, 20 avenue de la Gare, bureau 3.",
        "Apportez le titre de séjour qui autorise à travailler, le CV à jour et vos attestations de formation.",
        "Si vous ne pouvez pas venir, prévenez France Travail avant (espace personnel ou 39 49).",
      ],
      orientation: [
        "L'association peut vous aider à mettre votre CV à jour avant le rendez-vous.",
        "Pour changer le rendez-vous, contactez votre conseiller France Travail (coordonnées sur la lettre).",
      ],
    },
    en: {
      title: "France Travail invites you to an appointment on 25 November 2026.",
      summary:
        "Your France Travail advisor asks you to come to an appointment on 25 November 2026 at 14:00, in room 3 of the Valmont-Centre office. You must bring your residence permit that allows you to work, and your CV. You must be there. If you do not come without a reason, you can be removed from the list of job seekers. If you cannot come, you must warn them before the appointment.",
      actions: [
        "Write down the appointment: 25 November 2026 at 14:00, 20 avenue de la Gare, room 3.",
        "Bring your residence permit that allows work, your updated CV and your training certificates.",
        "If you cannot come, warn France Travail before (personal account or 39 49).",
      ],
      orientation: [
        "The association can help you update your CV before the appointment.",
        "To change the appointment, contact your France Travail advisor (details on the letter).",
      ],
    },
    ar: {
      title: "تدعوك France Travail إلى موعد يوم 25 نوفمبر 2026.",
      summary:
        "مستشارك في France Travail يطلب منك الحضور إلى موعد يوم 25 نوفمبر 2026 الساعة 14:00، في المكتب رقم 3 بوكالة Valmont-Centre. يجب أن تحضر بطاقة الإقامة التي تسمح لك بالعمل وسيرتك الذاتية (CV). الحضور إلزامي. إذا لم تحضر دون سبب، فقد يتم شطبك من قائمة الباحثين عن عمل. إذا لم تستطع الحضور، يجب أن تخبرهم قبل الموعد.",
      actions: [
        "سجّل الموعد: 25 نوفمبر 2026 الساعة 14:00، 20 avenue de la Gare، المكتب 3.",
        "أحضر بطاقة الإقامة التي تسمح بالعمل، وسيرتك الذاتية المحدّثة، وشهادات التكوين.",
        "إذا لم تستطع الحضور، أخبر France Travail قبل الموعد (حسابك الشخصي أو 39 49).",
      ],
      orientation: [
        "يمكن للجمعية أن تساعدك في تحديث سيرتك الذاتية قبل الموعد.",
        "لتغيير الموعد، اتصل بمستشارك في France Travail (البيانات في الرسالة).",
      ],
    },
  },
  {
    slug: "09-impots-declaration-rappel",
    letterhead: ["Direction générale des Finances publiques", "Service des impôts des particuliers de Valmont", "15 rue des Finances, 99000 Valmont"],
    refs: ["N° fiscal : 12 34 567 890 123", "Avis n° 2026-33-0912"],
    place: "Valmont, le 27 octobre 2026",
    recipient: ["Monsieur Ali HOSSEINI", "30 rue de la Fontaine", "99000 VALMONT"],
    subject: "Rappel - déclaration de revenus 2025 non reçue",
    body: [
      "Monsieur,",
      "Sauf erreur de notre part, nous n'avons pas reçu votre déclaration de revenus de l'année 2025. Même si vous n'avez eu aucun revenu en France, vous devez déposer une déclaration.",
      "Vous pouvez la déposer en ligne sur impots.example.fr (espace particulier) ou sur papier à l'adresse ci-dessus, au plus tard le 30 novembre 2026.",
      "Si vous ne déposez pas votre déclaration dans ce délai, vous pourrez recevoir une majoration de 10 % sur les impôts éventuellement dus, et votre situation pourra vous être demandée pour d'autres démarches (CAF, titre de séjour).",
      "Si vous avez déjà déposé votre déclaration, ne tenez pas compte de ce courrier.",
      "Nous restons à votre disposition pour toute information.",
    ],
    signature: ["Le comptable, responsable du service des impôts des particuliers"],
    footer: "Information : 0 809 00 00 00 (service gratuit + prix de l'appel).",
    facts: {
      isOfficialLetter: true,
      letterType: "tax",
      issuer: "Service des impôts des particuliers de Valmont",
      references: ["N° fiscal : 12 34 567 890 123", "Avis n° 2026-33-0912"],
      letterDate: "2026-10-27",
      deadline: { date: "2026-11-30", kind: "reply", explicit: true, sourceQuote: "au plus tard le 30 novembre 2026" },
      urgency: "medium",
      confidence: 0.94,
      reviewerWarnings: [],
    },
    fr: {
      title: "Les impôts vous rappellent de faire votre déclaration de revenus 2025 avant le 30 novembre 2026.",
      summary:
        "Les impôts n'ont pas reçu votre déclaration de revenus de 2025. La lettre dit qu'il faut la faire même si vous n'avez eu aucun revenu en France. Vous pouvez la faire en ligne ou sur papier, au plus tard le 30 novembre 2026. Sinon, il peut y avoir une majoration de 10 % sur les impôts éventuellement dus. Si vous avez déjà fait votre déclaration, ne tenez pas compte de cette lettre.",
      actions: [
        "Vérifiez si vous avez déjà fait la déclaration 2025.",
        "Si non, faites-la avant le 30 novembre 2026 (en ligne ou sur papier).",
        "Gardez la preuve de dépôt.",
      ],
      orientation: [
        "L'association peut vous aider à faire la déclaration en ligne.",
        "Pour une question sur votre dossier, appelez le service des impôts au numéro de la lettre.",
      ],
    },
    en: {
      title: "The tax office reminds you to file your 2025 income tax return before 30 November 2026.",
      summary:
        "The tax office has not received your 2025 income tax return. The letter says you must file it even if you had no income in France. You can file online or on paper, by 30 November 2026 at the latest. If not, a 10% surcharge can be added to any tax owed. If you have already filed your return, ignore this letter.",
      actions: [
        "Check whether you already filed the 2025 return.",
        "If not, file it before 30 November 2026 (online or on paper).",
        "Keep the proof of filing.",
      ],
      orientation: [
        "The association can help you file the return online.",
        "For a question about your file, call the tax office on the number in the letter.",
      ],
    },
    ar: {
      title: "تذكّرك مصلحة الضرائب بتقديم تصريح الدخل لعام 2025 قبل 30 نوفمبر 2026.",
      summary:
        "لم تتلقَّ مصلحة الضرائب تصريح دخلك لعام 2025. تقول الرسالة إنه يجب تقديمه حتى لو لم يكن لديك أي دخل في فرنسا. يمكنك تقديمه عبر الإنترنت أو على الورق، في موعد أقصاه 30 نوفمبر 2026. وإلا فقد تُضاف زيادة بنسبة 10٪ على الضرائب المستحقة إن وُجدت. إذا قدّمت تصريحك من قبل، فتجاهل هذه الرسالة.",
      actions: [
        "تحقق هل قدّمت تصريح 2025 من قبل.",
        "إذا لم تفعل، قدّمه قبل 30 نوفمبر 2026 (عبر الإنترنت أو على الورق).",
        "احتفظ بإثبات التقديم.",
      ],
      orientation: [
        "يمكن للجمعية أن تساعدك في تقديم التصريح عبر الإنترنت.",
        "لأي سؤال عن ملفك، اتصل بمصلحة الضرائب على الرقم المكتوب في الرسالة.",
      ],
    },
  },
  {
    slug: "10-bailleur-impaye-loyer",
    letterhead: ["Habitat Valmont", "Société anonyme d'HLM", "Service contentieux locatif", "2 square des Architectes, 99000 Valmont"],
    refs: ["Réf. locataire : L-045211", "Logement : Résidence Les Hortensias, bât. C, appt 21"],
    place: "Valmont, le 3 novembre 2026",
    recipient: ["Madame Aïcha TRAORÉ", "Résidence Les Hortensias, bât. C, appt 21", "14 avenue des Fleurs", "99000 VALMONT"],
    subject: "Mise en demeure - loyers impayés",
    body: [
      "Madame,",
      "À ce jour, votre compte locataire présente un solde débiteur de 1 240,00 euros, correspondant aux loyers et charges des mois de septembre, octobre et novembre 2026.",
      "Nous vous demandons de régler cette somme avant le 25 novembre 2026, ou de nous contacter pour convenir d'un plan d'apurement de votre dette.",
      "À défaut de règlement ou de prise de contact dans ce délai, nous serons dans l'obligation d'engager une procédure pouvant aller jusqu'à la résiliation du bail.",
      "Si vous rencontrez des difficultés, nous vous invitons à contacter votre assistante sociale ou le Fonds de solidarité pour le logement. Notre service est à votre écoute au 01 00 00 00 22.",
      "Veuillez agréer, Madame, l'expression de nos salutations distinguées.",
    ],
    signature: ["Le service contentieux locatif"],
    footer: "Paiement par virement, chèque ou en agence. Réf. à rappeler : L-045211.",
    facts: {
      isOfficialLetter: true,
      letterType: "housing",
      issuer: "Habitat Valmont",
      references: ["Réf. locataire : L-045211"],
      letterDate: "2026-11-03",
      deadline: { date: "2026-11-25", kind: "payment", explicit: true, sourceQuote: "avant le 25 novembre 2026" },
      urgency: "high",
      confidence: 0.94,
      reviewerWarnings: [
        "Mise en demeure du bailleur avec mention d'une procédure pouvant aller jusqu'à la résiliation du bail : orienter rapidement vers l'assistante sociale ou un juriste.",
      ],
    },
    fr: {
      title: "Votre bailleur vous demande de payer des loyers en retard avant le 25 novembre 2026.",
      summary:
        "Votre bailleur dit que vous devez 1 240,00 euros de loyers et charges (septembre, octobre et novembre 2026). Il demande de payer avant le 25 novembre 2026, ou de le contacter pour faire un plan de paiement. Sans paiement ni contact, le bailleur écrit qu'il peut lancer une procédure, qui peut aller jusqu'à la fin du bail. La lettre conseille aussi de voir une assistante sociale ou le Fonds de solidarité pour le logement.",
      actions: [
        "Appelez le bailleur au numéro de la lettre avant le 25 novembre 2026 pour parler d'un plan de paiement.",
        "Gardez vos preuves de paiement (virements, reçus) et apportez-les.",
        "Prenez rendez-vous avec une assistante sociale.",
      ],
      orientation: [
        "Venez vite à l'association avec cette lettre et vos preuves de paiement.",
        "L'assistante sociale ou le Fonds de solidarité pour le logement, cités dans la lettre, peuvent vous aider.",
      ],
    },
    en: {
      title: "Your landlord asks you to pay late rent before 25 November 2026.",
      summary:
        "Your landlord says you owe 1,240.00 euros of rent and charges (September, October and November 2026). It asks you to pay before 25 November 2026, or to contact them to agree a payment plan. Without payment or contact, the landlord writes that it can start a procedure, which can go as far as ending the lease. The letter also suggests seeing a social worker or the Housing Solidarity Fund.",
      actions: [
        "Call the landlord on the number in the letter before 25 November 2026 to talk about a payment plan.",
        "Keep your proof of payment (transfers, receipts) and bring it.",
        "Make an appointment with a social worker.",
      ],
      orientation: [
        "Come quickly to the association with this letter and your proof of payment.",
        "The social worker or the Housing Solidarity Fund, named in the letter, can help you.",
      ],
    },
    ar: {
      title: "يطلب منك مؤجّر السكن دفع إيجارات متأخرة قبل 25 نوفمبر 2026.",
      summary:
        "يقول مؤجّر السكن إنك مدين بمبلغ 1240٫00 يورو من الإيجار والرسوم (سبتمبر وأكتوبر ونوفمبر 2026). يطلب منك الدفع قبل 25 نوفمبر 2026، أو الاتصال به للاتفاق على خطة دفع. وإذا لم تدفع ولم تتصل، يكتب المؤجّر أنه قد يبدأ إجراءً قد يصل إلى إنهاء عقد الإيجار. وتنصحك الرسالة أيضًا بمقابلة مساعدة اجتماعية أو صندوق التضامن للسكن.",
      actions: [
        "اتصل بالمؤجّر على الرقم المكتوب في الرسالة قبل 25 نوفمبر 2026 للحديث عن خطة دفع.",
        "احتفظ بإثباتات الدفع (التحويلات، الإيصالات) وأحضرها.",
        "احجز موعدًا مع مساعدة اجتماعية.",
      ],
      orientation: [
        "تعال بسرعة إلى الجمعية ومعك هذه الرسالة وإثباتات الدفع.",
        "يمكن للمساعدة الاجتماعية أو صندوق التضامن للسكن، المذكورَين في الرسالة، أن يساعداك.",
      ],
    },
  },
];

export interface DocDef {
  slug: string;
  title: string;
  letterhead: string[];
  fields: [string, string][];
  analysis: { type: string; expiresAt: string | null; expirySourceQuote: string | null; confidence: number };
}

export const DOCUMENTS: DocDef[] = [
  {
    slug: "d1-recepisse",
    title: "RÉCÉPISSÉ DE DEMANDE DE TITRE DE SÉJOUR",
    letterhead: ["RÉPUBLIQUE FRANÇAISE", "Préfecture de Valmont"],
    fields: [
      ["Nom", "BENALI"],
      ["Prénom", "Samir"],
      ["Né(e) le", "01/01/1990"],
      ["N° étranger", "9900 1234 56"],
      ["Délivré le", "15/09/2026"],
      ["Valable jusqu'au", "14/03/2027"],
    ],
    analysis: { type: "recepisse", expiresAt: "2027-03-14", expirySourceQuote: "Valable jusqu'au 14/03/2027", confidence: 0.96 },
  },
  {
    slug: "d2-attestation-demande-asile",
    title: "ATTESTATION DE DEMANDE D'ASILE",
    letterhead: ["RÉPUBLIQUE FRANÇAISE", "Préfecture de Valmont - Guichet unique pour demandeurs d'asile"],
    fields: [
      ["Nom", "AHMADI"],
      ["Prénom", "Yusuf"],
      ["Né(e) le", "05/05/1988"],
      ["N° étranger", "9900 5555 08"],
      ["Délivrée le", "21/07/2026"],
      ["Valable jusqu'au", "20/01/2027"],
    ],
    analysis: { type: "attestation_demande_asile", expiresAt: "2027-01-20", expirySourceQuote: "Valable jusqu'au 20/01/2027", confidence: 0.95 },
  },
  {
    slug: "d3-attestation-domiciliation",
    title: "ATTESTATION DE DOMICILIATION",
    letterhead: ["Centre communal d'action sociale de Valmont", "Organisme agréé de domiciliation"],
    fields: [
      ["Nom", "RAHIMI"],
      ["Prénom", "Layla"],
      ["Adresse de domiciliation", "CCAS, 1 rue de la Mairie, 99000 Valmont"],
      ["Date d'élection de domicile", "01/01/2026"],
      ["Valable jusqu'au", "31/12/2026"],
    ],
    analysis: { type: "domiciliation", expiresAt: "2026-12-31", expirySourceQuote: "Valable jusqu'au 31/12/2026", confidence: 0.95 },
  },
];

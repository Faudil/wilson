import { describe, expect, it } from "bun:test";
import { contract, LANGUAGE_CODES, LetterAnalysisSchema, WaWebhookSchema } from "../src/index.js";

const analysis = {
  promptVersion: "letter-analysis@1",
  isOfficialLetter: true,
  letterType: "caf",
  issuer: "CAF de Seine-Saint-Denis",
  references: ["1234567"],
  letterDate: "2026-10-20",
  deadline: { date: "2026-11-20", kind: "reply", explicit: true, sourceQuote: "avant le 20/11/2026" },
  urgency: "medium",
  confidence: 0.9,
  reviewerWarnings: [],
  fr: { title: "Demande de pièces CAF", summary: "La CAF demande un justificatif.", actions: ["Envoyer l'avis d'imposition"], orientation: ["L'association peut vous aider à envoyer le document."] },
  target: { title: "CAF document request", summary: "CAF asks for a document.", actions: ["Send your tax notice"], orientation: ["The association can help you send it."] },
};

describe("contracts", () => {
  it("covers the required languages", () => {
    expect(LANGUAGE_CODES.slice(0, 10)).toEqual(["fr", "en", "ar", "fa", "ps", "ur", "uk", "ti", "so", "am"]);
    expect(LANGUAGE_CODES).toHaveLength(28);
  });
  it("accepts a valid LLM analysis", () => {
    expect(LetterAnalysisSchema.parse(analysis).letterType).toBe("caf");
  });
  it("requires at least one orientation pointer", () => {
    const bad = { ...analysis, target: { ...analysis.target, orientation: [] } };
    expect(LetterAnalysisSchema.safeParse(bad).success).toBe(false);
  });
  it("parses a Meta image webhook", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [{ id: "1", changes: [{ field: "messages", value: { messaging_product: "whatsapp", metadata: { phone_number_id: "9" },
        messages: [{ id: "wamid.1", from: "33612345678", timestamp: "1700000000", type: "image", image: { id: "m1", mime_type: "image/jpeg" } }] } }] }],
    };
    expect(WaWebhookSchema.parse(payload).entry[0]?.changes[0]?.value.messages?.[0]?.type).toBe("image");
  });
  it("exposes the expected procedure groups", () => {
    expect(Object.keys(contract).sort()).toEqual(["appointments", "auth", "beneficiaries", "broadcasts", "buddies", "conversations", "documents", "knowledge", "letters", "notes", "places", "sandbox", "skills", "system", "tasks", "usage", "volunteers"]);
  });
});

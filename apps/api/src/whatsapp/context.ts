import type { Deps } from "../deps.js";
import type { BeneficiariesService } from "../beneficiaries/service.js";
import type { DocumentsService } from "../documents/service.js";
import type { LettersService } from "../letters/service.js";

/** Deps + the services the WhatsApp side needs. Built once in main.ts: `{ ...deps, beneficiaries, documents, letters }`. */
export interface WaDeps extends Deps {
  beneficiaries: BeneficiariesService;
  documents: DocumentsService;
  letters: LettersService;
}

let registered: WaDeps | null = null;

/**
 * The oRPC context only carries `Deps`, so the letters/sandbox routers resolve the extra services from here.
 * main.ts must call this once after building the services.
 */
export function registerWaDeps(deps: WaDeps): void {
  registered = deps;
}

export function getWaDeps(): WaDeps {
  if (!registered) throw new Error("registerWaDeps() was not called at startup");
  return registered;
}

/** Calendar date (YYYY-MM-DD) of `now` in the configured timezone (Europe/Paris). */
export function todayIn(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

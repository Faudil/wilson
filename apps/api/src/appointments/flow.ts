/**
 * WhatsApp side of Rendez-vous (main menu 8). Numbered menus everywhere (buttons/lists when they fit); every
 * personal detail typed here goes straight into the encrypted help_requests row, never into the plain-JSON state.
 *
 *   8 → 1 accompany me → place (1–5) → date and time → city (0 = rather not say) → confirm → open
 *     → 2 fill in a form → which form (1–4) → free slots (or none) → may the volunteer see my documents? → booked / open
 *     → 3 my appointments → pick one → cancel? → cancelled
 *     → 4 workshops and meetings (Agenda, src/events/flow.ts)
 */
import { ACCOMPANIMENT_TOPICS, FORM_TOPICS, isRtl, type HelpTopic, type LanguageCode } from "@wilson/contracts";
import { parseUserDateTime, waText } from "@wilson/i18n";
import type { ConversationState } from "../db/schema.js";
import type { WaDeps } from "../whatsapp/context.js";
import { enqueueText } from "../whatsapp/send.js";
import { menuChoice } from "../conversation/text.js";
import { zonedDateTime } from "../time.js";
import { getAppointments } from "./service.js";
import { startEvents } from "../events/flow.js";

type HelpState = Extract<ConversationState, { step: `help_${string}` }>;
export const isHelpState = (s: ConversationState): s is HelpState => s.step.startsWith("help_");

export interface FlowIo {
  deps: WaDeps;
  beneficiaryId: string;
  lang: LanguageCode;
  setState(s: ConversationState): Promise<void>;
  showMainMenu(): Promise<void>;
}

const RLM = "‏";
/** An appointment must be at least this far ahead, and not absurdly far. */
const MIN_LEAD_MS = 60 * 60_000;
const MAX_AHEAD_MS = 366 * 24 * 3600_000;

const say = (io: FlowIo, body: string, menu = false) => enqueueText(io.deps, io.beneficiaryId, body, menu ? { interactive: true } : {});
const sayKey = (io: FlowIo, key: Parameters<typeof waText>[1], menu = false) => say(io, waText(io.lang, key), menu);
/** A menu line we build ourselves ("3 - mardi 12 novembre · 14:00"): RTL-safe like the catalog's. */
const optionLine = (io: FlowIo, n: number, label: string) => `${isRtl(io.lang) ? RLM : ""}${n} - ${label}`;

/** Main menu 8. */
export async function startHelp(io: FlowIo): Promise<void> {
  await io.setState({ step: "help_menu" });
  await sayKey(io, "help_menu", true);
}

/** Every inbound message while the conversation is in a help_* step. `text` = null for photos, voice notes… */
export async function onHelpState(io: FlowIo, state: HelpState, text: string | null): Promise<void> {
  const svc = getAppointments(io.deps);
  const choice = text === null ? null : menuChoice(text);

  switch (state.step) {
    case "help_menu": {
      if (choice === "1") {
        await io.setState({ step: "help_topic", kind: "accompaniment" });
        return sayKey(io, "help_place_menu", true);
      }
      if (choice === "2") {
        await io.setState({ step: "help_topic", kind: "form_session" });
        return sayKey(io, "help_form_menu", true);
      }
      if (choice === "3") return showList(io);
      if (choice === "4") return startEvents(io);
      if (choice === "0") return io.showMainMenu();
      return sayKey(io, "help_menu", true);
    }

    case "help_topic": {
      const topics: readonly HelpTopic[] = state.kind === "accompaniment" ? ACCOMPANIMENT_TOPICS : FORM_TOPICS;
      const topic = choice ? topics[Number(choice) - 1] : undefined;
      if (!topic) return sayKey(io, state.kind === "accompaniment" ? "help_place_menu" : "help_form_menu", true);
      const requestId = await svc.createDraft(io.beneficiaryId, topic);
      if (state.kind === "accompaniment") {
        await io.setState({ step: "help_datetime", requestId });
        return sayKey(io, "help_ask_datetime");
      }
      return offerSlots(io, requestId);
    }

    case "help_datetime": {
      const parsed = text ? parseUserDateTime(text) : null;
      const at = parsed ? zonedDateTime(parsed.date, parsed.time, io.deps.config.TIMEZONE) : null;
      const now = io.deps.now().getTime();
      if (!at || at.getTime() < now + MIN_LEAD_MS || at.getTime() > now + MAX_AHEAD_MS) return sayKey(io, "help_datetime_invalid");
      await svc.setDraftTime(state.requestId, at);
      await io.setState({ step: "help_city", requestId: state.requestId });
      return sayKey(io, "help_ask_city");
    }

    case "help_city": {
      if (!text?.trim()) return sayKey(io, "help_ask_city");
      await svc.setDraftCity(io.beneficiaryId, state.requestId, choice === "0" ? null : text);
      return confirm(io, state.requestId);
    }

    case "help_confirm": {
      if (choice === "1") {
        await svc.submit(state.requestId);
        await sayKey(io, "help_request_sent");
        return io.showMainMenu();
      }
      if (choice === "2") {
        await svc.discardDraft(state.requestId);
        return io.showMainMenu();
      }
      return confirm(io, state.requestId);
    }

    case "help_slot": {
      if (choice === "0") return askConsent(io, state.requestId, undefined);
      const slotId = choice ? state.slotIds[Number(choice) - 1] : undefined;
      if (!slotId) return offerSlots(io, state.requestId);
      return askConsent(io, state.requestId, slotId);
    }

    case "help_consent": {
      if (choice !== "1" && choice !== "2") return sayKey(io, "help_consent", true);
      const consent = choice === "1";
      if (state.slotId) {
        const result = await svc.book(state.requestId, state.slotId, consent); // sends the confirmation itself
        if (result === "taken") return offerSlots(io, state.requestId); // someone was faster: show what is left
        return io.showMainMenu();
      }
      await svc.submit(state.requestId, { documentsConsent: consent });
      await sayKey(io, "help_request_sent");
      return io.showMainMenu();
    }

    case "help_list": {
      if (choice === "0") return startHelp(io);
      const requestId = choice ? state.requestIds[Number(choice) - 1] : undefined;
      if (!requestId) return showList(io);
      const r = await svc.getOwn(io.beneficiaryId, requestId);
      if (!r) return showList(io);
      await io.setState({ step: "help_cancel", requestId });
      return say(io, await svc.text(io.lang, "help_cancel_confirm", r), true);
    }

    case "help_cancel": {
      if (choice === "1") {
        await svc.cancelByBeneficiary(io.beneficiaryId, state.requestId);
        await sayKey(io, "help_cancelled");
        return io.showMainMenu();
      }
      if (choice === "2") return showList(io);
      const r = await svc.getOwn(io.beneficiaryId, state.requestId);
      if (!r) return io.showMainMenu();
      return say(io, await svc.text(io.lang, "help_cancel_confirm", r), true);
    }
  }
}

async function confirm(io: FlowIo, requestId: string): Promise<void> {
  const svc = getAppointments(io.deps);
  const r = await svc.getOwn(io.beneficiaryId, requestId);
  if (!r) return io.showMainMenu();
  await io.setState({ step: "help_confirm", requestId });
  await say(io, await svc.text(io.lang, "help_confirm", r), true);
}

async function offerSlots(io: FlowIo, requestId: string): Promise<void> {
  const svc = getAppointments(io.deps);
  const slots = await svc.offerableSlots();
  if (slots.length === 0) {
    await sayKey(io, "help_no_slots");
    return askConsent(io, requestId, undefined);
  }
  await io.setState({ step: "help_slot", requestId, slotIds: slots.map((s) => s.id) });
  const lines = slots.map((s, i) => optionLine(io, i + 1, `${svc.when(s.startsAt, io.lang)} — ${s.place}`));
  await say(io, [waText(io.lang, "help_slots_intro"), ...lines, waText(io.lang, "help_slots_other")].join("\n"), true);
}

async function askConsent(io: FlowIo, requestId: string, slotId: string | undefined): Promise<void> {
  await io.setState(slotId ? { step: "help_consent", requestId, slotId } : { step: "help_consent", requestId });
  await sayKey(io, "help_consent", true);
}

async function showList(io: FlowIo): Promise<void> {
  const svc = getAppointments(io.deps);
  const rows = await svc.listForBeneficiary(io.beneficiaryId);
  if (rows.length === 0) {
    await sayKey(io, "help_list_empty");
    return startHelp(io);
  }
  await io.setState({ step: "help_list", requestIds: rows.map((r) => r.id) });
  const lines = await Promise.all(rows.map(async (r, i) => {
    const status = r.status === "accepted" ? "✅" : "⏳";
    const label = (await svc.summary(r, io.lang, null)).split("\n").map((l) => l.replace(/^‏?(📌|📅)\s*/u, "").trim()).join(" · ");
    return optionLine(io, i + 1, `${status} ${label}`);
  }));
  await say(io, [waText(io.lang, "help_list_intro"), ...lines, waText(io.lang, "help_list_back")].join("\n"), true);
}

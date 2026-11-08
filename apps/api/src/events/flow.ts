/**
 * WhatsApp side of the Agenda (menu 8 → 4): public events, translated into the person's language.
 *
 *   8 → 4 → list of up to 9 upcoming public events (✅ registered, ⏳ waiting list) → pick one → detail
 *     → 1 register (or join the waiting list when full) / 2 cancel my registration / 0 back to the list
 *
 * The state only carries event ids; whether the person is registered is read from event_registrations each time.
 */
import { isRtl, type LanguageCode } from "@wilson/contracts";
import { eventText } from "@wilson/i18n";
import type { ConversationState } from "../db/schema.js";
import { menuChoice } from "../conversation/text.js";
import type { FlowIo } from "../appointments/flow.js";
import { enqueueText } from "../whatsapp/send.js";
import { getEvents } from "./service.js";

type EventState = Extract<ConversationState, { step: `event_${string}` }>;
export const isEventState = (s: ConversationState): s is EventState => s.step.startsWith("event_");

const RLM = "‏";
const optionLine = (lang: LanguageCode, n: number, label: string) => `${isRtl(lang) ? RLM : ""}${n} - ${label}`;
const say = (io: FlowIo, body: string, menu = false) => enqueueText(io.deps, io.beneficiaryId, body, menu ? { interactive: true } : {});

/** Menu 8 → 4: the list of upcoming public events. */
export async function startEvents(io: FlowIo): Promise<void> {
  const svc = getEvents(io.deps);
  const rows = await svc.offerable();
  if (rows.length === 0) {
    await say(io, eventText(io.lang, "events_none"));
    return io.showMainMenu();
  }
  const mine = await svc.registrationsOf(io.beneficiaryId);
  await io.setState({ step: "event_list", eventIds: rows.map((r) => r.id) });
  const lines = await Promise.all(rows.map(async (r, i) => {
    const reg = mine.get(r.id);
    const mark = reg?.status === "going" ? "✅ " : reg ? "⏳ " : "";
    return optionLine(io.lang, i + 1, mark + (await svc.listLabel(r, io.lang, io.beneficiaryId)));
  }));
  await say(io, [eventText(io.lang, "events_intro"), ...lines, eventText(io.lang, "events_back")].join("\n"), true);
}

async function showDetail(io: FlowIo, eventId: string): Promise<void> {
  const svc = getEvents(io.deps);
  const r = await svc.publicRow(eventId);
  if (!r) return startEvents(io);
  await io.setState({ step: "event_detail", eventId });
  const { text } = await svc.detailFor(r, io.lang, io.beneficiaryId);
  await say(io, text, true);
}

/** Every inbound message while the conversation is in an event_* step. `text` = null for photos, voice notes… */
export async function onEventState(io: FlowIo, state: EventState, text: string | null): Promise<void> {
  const svc = getEvents(io.deps);
  const choice = text === null ? null : menuChoice(text);

  switch (state.step) {
    case "event_list": {
      if (choice === "0") return io.showMainMenu();
      const id = choice ? state.eventIds[Number(choice) - 1] : undefined;
      if (!id) return startEvents(io);
      return showDetail(io, id);
    }

    case "event_detail": {
      if (choice === "0") return startEvents(io);
      const r = await svc.publicRow(state.eventId);
      if (!r) return startEvents(io);
      const { state: where } = await svc.detailFor(r, io.lang, io.beneficiaryId);
      if (choice === "1" && (where === "join" || where === "waitlist")) {
        const result = await svc.registerBeneficiary(r.id, io.beneficiaryId); // sends the confirmation itself
        if (result === "closed") return showDetail(io, r.id);
        return io.showMainMenu();
      }
      if (choice === "2" && (where === "registered" || where === "waiting")) {
        await svc.unregisterBeneficiary(r.id, io.beneficiaryId);
        await say(io, eventText(io.lang, "events_left"));
        return io.showMainMenu();
      }
      return showDetail(io, r.id);
    }
  }
}

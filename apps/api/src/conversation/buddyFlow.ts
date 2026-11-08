/**
 * WhatsApp side of the French practice buddies (main menu 7). Numbered menus only, like every other flow; free text
 * is only taken where the person was asked for it (a message for their buddy, a report), and "0" always cancels.
 */
import type { BuddyModePreference, BuddyWindow, LanguageCode } from "@wilson/contracts";
import { buddyText, formatDate } from "@wilson/i18n";
import type { ConversationState } from "../db/schema.js";
import { BuddyError, getBuddies, type MatchRow } from "../buddies/service.js";
import { localDate } from "../time.js";
import type { WaDeps } from "../whatsapp/context.js";
import { isMenuWord, menuChoice } from "./text.js";

type BuddyStep = Extract<ConversationState, { step: `buddy_${string}` }>;

export type BuddyInput =
  | { type: "text"; text: string }
  | { type: "file" | "voice" | "media_unsupported" | "other" | "ignore" | "button" };

/** What the engine lends the flow (its Ctx stays private). */
export interface BuddyFlowCtx {
  deps: WaDeps;
  beneficiaryId: string;
  lang: LanguageCode;
  state: ConversationState;
  /** A web account: no phone number to share, so the buddy can only write through Wilson. */
  web: boolean;
  setState(s: ConversationState): Promise<void>;
  say(text: string, opts?: { menu?: boolean }): Promise<void>;
  showMainMenu(): Promise<void>;
}

const WINDOWS: Record<string, BuddyWindow> = { "1": "weekday_morning", "2": "weekday_afternoon", "3": "weekday_evening", "4": "weekend" };
const MODES: Record<string, BuddyModePreference> = { "1": "call", "2": "meet", "3": "either" };

export const isBuddyStep = (s: ConversationState): s is BuddyStep => s.step.startsWith("buddy_");

const t = (f: BuddyFlowCtx, key: Parameters<typeof buddyText>[1], params?: Parameters<typeof buddyText>[2]) => buddyText(f.lang, key, params);
const svc = (f: BuddyFlowCtx) => getBuddies(f.deps);

async function toMain(f: BuddyFlowCtx, text?: string) {
  await f.setState({ step: "main_menu" });
  if (text) await f.say(text);
}

async function showProposal(f: BuddyFlowCtx, m: MatchRow) {
  const d = await svc(f).describe(m, null, f.lang);
  await f.setState({ step: "buddy_proposal", matchId: m.id });
  await f.say(t(f, "buddy_proposal", d), { menu: true });
}

async function showMenu(f: BuddyFlowCtx, m: MatchRow) {
  const d = await svc(f).describe(m, await svc(f).nextSession(m.id), f.lang);
  await f.setState({ step: "buddy_menu", matchId: m.id });
  await f.say(t(f, "buddy_menu", { name: d.name, date: d.date, time: d.time }), { menu: true });
}

async function welcome(f: BuddyFlowCtx, m: MatchRow) {
  const d = await svc(f).describe(m, await svc(f).nextSession(m.id), f.lang);
  await toMain(f, t(f, "buddy_active", { name: d.name, date: d.date, time: d.time }));
}

/** Main menu "7": what to show depends on where the person is (no request, waiting, proposal, pairing). */
export async function buddyEntry(f: BuddyFlowCtx): Promise<void> {
  const { request, match } = await svc(f).openFor(f.beneficiaryId);
  if (match?.status === "proposed") return showProposal(f, match);
  if (match?.status === "active") return showMenu(f, match);
  if (match?.status === "suspended") return toMain(f, t(f, "buddy_paused", { name: (await svc(f).describe(match, null, f.lang)).name }));
  if (request) {
    await f.setState({ step: "buddy_waiting", requestId: request.id });
    return f.say(t(f, "buddy_waiting"), { menu: true });
  }
  await f.setState({ step: "buddy_when" });
  return f.say(t(f, "buddy_intro"), { menu: true });
}

/** The pairing a state points at, if it is still in a status where that state makes sense; else start over. */
async function current(f: BuddyFlowCtx, matchId: string, statuses: MatchRow["status"][]): Promise<MatchRow | null> {
  const { match } = await svc(f).openFor(f.beneficiaryId);
  return match && match.id === matchId && statuses.includes(match.status) ? match : null;
}

export async function onBuddyState(f: BuddyFlowCtx, state: BuddyStep, input: BuddyInput): Promise<void> {
  const text = input.type === "text" ? input.text : null;
  if (text !== null && isMenuWord(text)) return f.showMainMenu();
  const choice = text !== null ? menuChoice(text) : null;
  const again = () => buddyEntry(f);

  switch (state.step) {
    case "buddy_when": {
      if (choice === "0") return f.showMainMenu();
      const w = choice ? WINDOWS[choice] : undefined;
      if (!w) return f.say(t(f, "buddy_intro"), { menu: true });
      await f.setState({ step: "buddy_how", window: w });
      return f.say(t(f, "buddy_ask_mode"), { menu: true });
    }
    case "buddy_how": {
      if (choice === "0") return f.showMainMenu();
      const mode = choice ? MODES[choice] : undefined;
      if (!mode) return f.say(t(f, "buddy_ask_mode"), { menu: true });
      try {
        await svc(f).createRequest(f.beneficiaryId, [state.window], mode);
      } catch (e) {
        if (e instanceof BuddyError) return again(); // already has a pairing meanwhile
        throw e;
      }
      return toMain(f, t(f, "buddy_requested"));
    }
    case "buddy_waiting": {
      if (choice === "2") {
        await svc(f).cancelRequest(f.beneficiaryId);
        return toMain(f, t(f, "buddy_cancelled"));
      }
      if (choice === "1" || choice === "0") return f.showMainMenu();
      return again();
    }
    case "buddy_proposal": {
      const m = await current(f, state.matchId, ["proposed"]);
      if (!m) return again();
      if (choice === "1") {
        await svc(f).accept(m.id);
        if (m.mode === "call" && !f.web) {
          await f.setState({ step: "buddy_consent", matchId: m.id, afterAccept: true });
          return f.say(t(f, "buddy_consent", { name: (await svc(f).describe(m, null, f.lang)).name }), { menu: true });
        }
        return welcome(f, { ...m, status: "active" });
      }
      if (choice === "2") {
        await svc(f).decline(m.id);
        return toMain(f, t(f, "buddy_declined"));
      }
      return showProposal(f, m);
    }
    case "buddy_consent": {
      const m = await current(f, state.matchId, ["active"]);
      if (!m) return again();
      const name = (await svc(f).describe(m, null, f.lang)).name;
      if (choice !== "1" && choice !== "2") return f.say(t(f, "buddy_consent", { name }), { menu: true });
      await svc(f).setConsent(m.id, choice === "1");
      await f.say(t(f, choice === "1" ? "buddy_number_shared" : "buddy_consent_no", { name }));
      return state.afterAccept ? welcome(f, m) : toMain(f);
    }
    case "buddy_menu": {
      const m = await current(f, state.matchId, ["active"]);
      if (!m) return again();
      const name = (await svc(f).describe(m, null, f.lang)).name;
      switch (choice) {
        case "1":
          await f.setState({ step: "buddy_write", matchId: m.id });
          return f.say(t(f, "buddy_write_ask", { name }));
        case "2": {
          const s = await svc(f).skipNext(m.id, "beneficiary");
          if (!s) return showMenu(f, m);
          return toMain(f, t(f, "buddy_skipped", { name, date: formatDate(localDate(s.startsAt, f.deps.config.TIMEZONE), f.lang, { weekday: true }) }));
        }
        case "3":
          if (f.web) return toMain(f, t(f, "buddy_consent_no", { name }));
          if (m.contactShared) {
            await svc(f).setConsent(m.id, false);
            return toMain(f, t(f, "buddy_number_private", { name }));
          }
          await f.setState({ step: "buddy_consent", matchId: m.id });
          return f.say(t(f, "buddy_consent", { name }), { menu: true });
        case "4":
          await f.setState({ step: "buddy_stop", matchId: m.id });
          return f.say(t(f, "buddy_stop_confirm", { name }), { menu: true });
        case "5":
          await f.setState({ step: "buddy_report", matchId: m.id });
          return f.say(t(f, "buddy_report_ask"));
        case "0":
          return f.showMainMenu();
        default:
          return showMenu(f, m);
      }
    }
    case "buddy_write": {
      if (choice === "0") return f.showMainMenu();
      const m = await current(f, state.matchId, ["active"]);
      if (!m) return again();
      const name = (await svc(f).describe(m, null, f.lang)).name;
      if (!text?.trim()) return f.say(t(f, "buddy_write_ask", { name }));
      await svc(f).messageFromBeneficiary(m.id, text.slice(0, 2000));
      return toMain(f, t(f, "buddy_message_sent", { name }));
    }
    case "buddy_stop": {
      const m = await current(f, state.matchId, ["active", "suspended"]);
      if (!m) return again();
      if (choice === "1") {
        await svc(f).end(m.id, "beneficiary");
        return toMain(f, t(f, "buddy_stopped"));
      }
      if (choice === "2") return showMenu(f, m);
      return f.say(t(f, "buddy_stop_confirm", { name: (await svc(f).describe(m, null, f.lang)).name }), { menu: true });
    }
    case "buddy_report": {
      if (choice === "0") return f.showMainMenu();
      const m = await current(f, state.matchId, ["proposed", "active", "suspended"]);
      if (!m) return again();
      if (!text || text.trim().length < 3) return f.say(t(f, "buddy_report_ask"));
      await svc(f).report(m.id, "beneficiary", text.slice(0, 2000));
      return toMain(f, t(f, "buddy_report_received"));
    }
  }
}

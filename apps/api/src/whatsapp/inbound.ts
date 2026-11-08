import type { WaInboundMessage } from "@wilson/contracts";
import type { InboundContent, InboundMessage } from "../channels/types.js";

/** WhatsApp webhook message → channel-neutral message for the conversation engine. */
export function fromWhatsApp(msg: WaInboundMessage): InboundMessage {
  return { channel: "whatsapp", id: msg.id, from: msg.from, userId: msg.from_user_id, content: content(msg) };
}

function content(msg: WaInboundMessage): InboundContent {
  switch (msg.type) {
    case "text": return { type: "text", text: msg.text.body };
    case "image": return { type: "file", kind: "image", mediaId: msg.image.id, mime: msg.image.mime_type, caption: msg.image.caption };
    case "document": return { type: "file", kind: "document", mediaId: msg.document.id, mime: msg.document.mime_type, caption: msg.document.caption };
    case "interactive": {
      // Button and list ids are the menu numbers (see whatsapp/interactive.ts): same as typing them.
      const r = msg.interactive.button_reply ?? msg.interactive.list_reply;
      return r ? { type: "choice", id: r.id, title: r.title } : { type: "other" };
    }
    case "button": return { type: "button", text: msg.button.text };
    case "location": return { type: "location", lat: msg.location.latitude, lon: msg.location.longitude };
    case "audio": return { type: "voice" };
    case "video": case "sticker": return { type: "media_unsupported" };
    case "reaction": return { type: "reaction" };
    case "system": {
      const s = msg.system;
      return { type: "identity_change", address: s.wa_id ?? s.new_wa_id, userId: s.user_id, previousUserId: s.previous_user_id, reason: s.type };
    }
    default: return { type: "other" };
  }
}

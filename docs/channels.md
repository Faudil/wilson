# Messaging channels

Wilson talks to people through **channels**. Today there is one, WhatsApp (Meta Cloud API, or the sandbox). The code
is split so that Telegram, SMS or anything else can be added as an adapter, without touching the conversation engine,
the letters, documents, reminders, announcements or the back-office.

```
 provider webhook ──► adapter: parse + authenticate ──► InboundMessage ──► receiveInbound()
                                                                              │ conversation engine (menus, letters,
                                                                              │ chatbot, documents…), unchanged
 provider API ◄── ChannelTransport (per channel) ◄── wa.send queue ◄──────────┘ replies go on the person's channel
```

## The pieces (`apps/api/src/channels/`)

| File | What it holds |
|---|---|
| `types.ts` | `ChannelId` (`whatsapp`, `telegram`, `sms`), `ChannelTransport` (outbound), `InboundMessage` / `InboundContent` (inbound, channel-neutral) |
| `registry.ts` | `Channels`: one transport per channel, `deps.channels.get(id)`; `windowOpenFor`, `sendTemplateVia` |
| `receive.ts` | `receiveInbound` (conversation + read receipt, never throws) and `applyDeliveryStatus` (delivery receipts) |

WhatsApp is the reference adapter: `whatsapp/meta.ts` and `whatsapp/sandbox.ts` implement the transport,
`whatsapp/inbound.ts` turns a webhook message into an `InboundMessage`, `whatsapp/webhook.ts` checks the signature.

Each person has one channel (`beneficiaries.channel`, text, default `whatsapp`) and one address on it
(`wa_id_*` columns: phone number, WhatsApp BSUID, Telegram chat id…). Replies, reminders and announcements go back on
that channel. The lookup hash is the bare address on WhatsApp (existing rows) and `<channel>:<address>` on the others,
so the same digits on two channels are two different people.

## Rules every adapter follows

- **Ids are unique across channels.** Inbound and outbound message ids share `messages.wa_message_id` (dedup and
  delivery receipts). WhatsApp keeps `wamid.…`; every other channel prefixes its ids: `telegram:8812`.
- **Authenticate before parsing.** Like WhatsApp's `X-Hub-Signature-256`: Telegram's secret-token header, Twilio's
  signature… An unauthenticated webhook would let anyone spend the Claude budget.
- **Answer the provider at once**, then process (providers retry slow or failed webhooks).
- **Map everything** to an `InboundContent`: text, file (image/document with a `mediaId` your `downloadMedia`
  understands), `choice` (a tap on one of our buttons: the id is the menu number), location, voice, `other`…
- **Capabilities, not `if (channel === …)`.** `serviceWindow: true` only for WhatsApp's 24 h rule (then
  `sendTemplate` is required). No `sendInteractive` = menus are sent as numbered text. Long texts: the transport splits.
- **Never log addresses or message bodies.**

## Adding Telegram (example)

1. `src/telegram/transport.ts`: `class TelegramTransport implements ChannelTransport` with `channel = "telegram"`,
   `capabilities = { serviceWindow: false }`, `sendText` (`sendMessage`), optionally `sendInteractive` (inline
   keyboard, `callback_data` = the choice id), `downloadMedia` (`getFile`), ids returned as `telegram:<message_id>`.
2. `src/telegram/webhook.ts`: check `X-Telegram-Bot-Api-Secret-Token`, reply 200, turn each update into an
   `InboundMessage` (`from` = chat id, `id` = `telegram:<update_id>`), call `receiveInbound(deps, msg)`.
3. Config (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`), the route in `server.ts`, and the transport in
   `createChannels()` (`whatsapp/index.ts`) when the token is set.
4. Tests: copy `test/channels.test.ts`, which already runs a fake Telegram next to WhatsApp.

An SMS adapter is the same with `sendInteractive` left out and no `downloadMedia` content (SMS has no photos).

## Still WhatsApp-specific (fine for now)

- Templates (`whatsapp/templates.ts`, `wa:setup`), Meta error codes, BSUIDs: only reached when `serviceWindow` is true
  or from the WhatsApp adapter.
- Names: `WaDeps`, the `wa.send` queue, `wa_id_*` columns, the `/sandbox` page (a fake WhatsApp phone). Renaming
  them would touch most files for no behaviour change.
- The back-office label shows "•• •• •• •• 21" (last digits of a phone number); a Telegram person shows their
  chat id's last digits. A channel badge can come with the first real second channel.
- Buddy "share my number" only works for WhatsApp and SMS people.

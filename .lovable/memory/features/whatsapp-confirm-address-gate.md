---
name: WhatsApp confirm-button address gate
description: Customer YES button OR text reply auto-confirms when stored address is deliverable; otherwise AI takes over to validate the delivery address with the customer, then auto-confirms.
type: feature
---

When a customer engages with the order on WhatsApp — whether by clicking a confirm button (YES / Confirmer / "Confirm my order") OR by replying with any text to the template / AI — we evaluate the **stored** address:

- **Stored address is ALREADY deliverable** → confirm immediately. We set `confirmation_status="confirmed"`, `confirmation_channel="whatsapp"`, `whatsapp_status="confirmed"`, `confirmed_at=now()`, optionally book shipping. We do NOT wait for the AI extractor to find new address details — there are none.
- **Stored address is missing/weak** → gate through the AI: stash `pending_button_intent` (button path) OR keep status `new` (text path), force AI takeover, ask the customer for their full address, finalize via `tryExtractAndConfirmAddress` once they reply with usable detail.

## Why the broadened short-circuit (AB-718 fix)
Originally the stored-address short-circuit inside `tryExtractAndConfirmAddress` only fired when `pending_button_intent.intent === "confirm"` (button path). For orders where the sheet-imported address was ALREADY deliverable but the customer replied to the template with TEXT (e.g. "Ok", "Original chahi ya", "Delivery open") instead of clicking the button:
- The AI continuation generated a "Your order is confirmed" reply (correct UX).
- The extractor ran on the customer's generic text → returned `complete=false` → no DB update.
- Order stayed `confirmation_status="new"` forever even though the customer was told it was confirmed.

Now: **any** customer engagement (button OR text) on an order with a deliverable stored address auto-confirms via the stored-address branch. Only orders with weak/missing stored addresses still need the AI extractor to mine new address detail from the customer's text.

## isAddressDeliverable heuristic (shared)
Rejects: too short (<10 chars), <2 tokens, fake/test/placeholder words, addresses with no number AND no street keyword. Accepts addresses with a number OR a street keyword (house, street, road, lane, block, sector, mohalla, near, chowk, station, etc., including Urdu equivalents) AND a non-empty city.

## tryExtractAndConfirmAddress skip-rule
Extraction (called inside `aiContinueReply` on inbound text) skips ONLY when ALL three are true:
1. `confirmation_status === "confirmed"`
2. The stored address `isDeliverable`
3. There is NO `pending_button_intent` on the conversation

If any pending_button_intent exists, extraction always runs (so the badge gets cleared and history gets logged) even on already-confirmed orders.

## Stored-address short-circuit (the broadened branch)
Inside `tryExtractAndConfirmAddress`, BEFORE calling OpenAI, if `isAddressDeliverable(stored) && confirmation_status !== "confirmed"`, we finalize the existing address: update orders + conversation, log `ai_confirm` history, optionally trigger auto-book. We never call OpenAI and never overwrite the stored address.

## CRITICAL — Customer-only history when extracting (AB-687 fix)
`tryExtractAndConfirmAddress` feeds ONLY messages with `role === "user"` (customer turns) to the OpenAI extractor. Including assistant turns previously caused the AI to read back the address the bot had echoed (e.g. "Should we deliver to: <stored address>?") and treat it as customer-provided, so a bare "YES" reply looked like a complete address and auto-confirmed the order. The extractor prompt also explicitly REJECTS bare affirmations ("yes", "ok", "haan", "confirm", "cash on delivery", "COD", "send karo", "deliver kar do", "thik hai") as incomplete addresses, even when prior messages contained one.

## CRITICAL — Bot must not push YES gate on info questions (AB-687 fix)
The `aiContinueReply` system prompt for orders WITH a stored address now instructs the AI:
- DO NOT proactively send "Should we deliver to <address>? Reply YES" unless the customer is clearly trying to confirm in this very message (used words like "confirm", "ship it", "send it", "haan bhej do", "deliver kar do").
- If the customer is asking an info question (price, payment method like "cash on delivery", color, delivery time, return policy), JUST answer naturally. Do NOT prompt with the stored address.
- A bare "yes / ok / sahi" reply only counts as confirmation if the bot's IMMEDIATELY PREVIOUS message asked them to confirm.

## Dedup-bypass when customer message is newer than last outbound (AB-395)
The AI continuation pipeline applies a dedup window (`ai_dedup_window_seconds`, default 30s) to avoid double-replies. Previously, when a customer clicked YES + sent a follow-up question (e.g. "send me the product picture") in the same webhook batch, `applyOutcome` would auto-send the "order confirmed" template, then the AI continuation got blocked by dedup and the picture request was dropped. Now: if the latest inbound message is newer than the most recent outbound, dedup is bypassed so the AI always answers the pending customer question.

## Inbox UI
The conversation list in `WhatsappInbox.tsx` shows a yellow "⏳ Awaiting address" badge next to any conversation whose `pending_button_intent.intent === "confirm"`.

## Files
- `supabase/functions/whatsapp-webhook/index.ts` — `applyOutcome` confirms immediately when stored address is deliverable, else gates; `tryExtractAndConfirmAddress` short-circuit auto-confirms on ANY engagement (button OR text) when the stored address is already deliverable; extractor uses customer-only history.
- `supabase/functions/whatsapp-automation-runner/index.ts` — `applyButtonAction` sets `forceAddressGate = wantsConfirm && !!order && !storedAddrDeliverable` (gate skipped when address is good).
- `src/pages/whatsapp/WhatsappInbox.tsx` — "⏳ Awaiting address" pill in conversation list.

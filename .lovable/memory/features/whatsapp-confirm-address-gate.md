---
name: WhatsApp confirm-button address gate
description: Customer YES/Confirm button NEVER finalizes the order. AI ALWAYS takes over to validate the delivery address with the customer, then auto-confirms.
type: feature
---

When a customer clicks a confirm button (YES / Confirmer / "Confirm my order") on any WhatsApp template — whether it goes through `whatsapp-webhook.applyOutcome` or the automation-runner `applyButtonAction` — we **ALWAYS** force AI address validation BEFORE flipping `confirmation_status` to `confirmed`. The stored address is **never trusted** at button-click time.

## Why we always gate (not just when the address looks bad)
Sheet imports often produce vague but heuristically-passing addresses (e.g. "Mansehra near foji"). The old logic only gated when `isAddressDeliverable` returned false on the stored address, so these imports would confirm immediately on a button click — before the customer ever sent their real address. Worse, this caused a race where `applyOutcome` confirmed the order and `applyButtonAction` simultaneously stashed `pending_button_intent`, leaving an "Awaiting address" badge stuck on a confirmed order.

The fix: confirm buttons are now **always** gated. The AI ALWAYS asks the customer for the full address, AI extracts and patches the order, and only THEN sets `confirmation_status = "confirmed"` and clears `pending_button_intent`.

## Logic
On any confirm-intent button click (in either the webhook or the automation runner):

- `confirmation_status` is **NOT** changed.
- `whatsapp_status = "pending_address"` and a `whatsapp_note` is written.
- `whatsapp_conversations.pending_button_intent = { intent: "confirm", button_text, mapped_status: "confirmed", created_at }` is stashed.
- `whatsapp_conversations.ai_enabled = true` (AI takeover forced).
- The AI continuation runs and reads `pending_button_intent` from a fresh refetch of `conv` (NOT the stale snapshot from before applyOutcome). Its system prompt instructs it to:
  - Thank the customer for confirming.
  - In the SAME short message ask politely (in customer language) for the FULL address: house/flat #, street, area/block, landmark + city.
  - NEVER say "your order is being processed" or "your order is confirmed" until the address is real.
- When the customer replies with a real address, `tryExtractAndConfirmAddress` extracts city + full_address, updates the order, sets `confirmation_status = "confirmed"`, clears `pending_button_intent`, and (if `auto_book_shipping`) marks `delivery_status = "booked"`.

## tryExtractAndConfirmAddress skip-rule
Extraction now skips ONLY when ALL three are true:
1. `confirmation_status === "confirmed"`
2. The stored address `isDeliverable`
3. There is NO `pending_button_intent` on the conversation

If any pending_button_intent exists, extraction always runs (so the badge gets cleared and history gets logged) even on already-confirmed orders.

## Stored-address short-circuit (CRITICAL)
When the customer clicks "Confirm" and the stored address is ALREADY deliverable, there is no new address text in their next message (the customerText is just the button label). Without a short-circuit the AI extractor returns `complete: false` and the order is stuck on `new` forever (e.g. AB-363).

`tryExtractAndConfirmAddress` short-circuits when ALL of:
- `pending_button_intent.intent === "confirm"`
- the stored address is already deliverable
- the order is not yet confirmed

→ It finalizes the existing address directly: sets `confirmation_status = "confirmed"`, `confirmation_channel = "whatsapp"`, `whatsapp_status = "confirmed"`, clears `pending_button_intent`, optionally books shipping, logs `ai_confirm` history. No OpenAI call needed.

## Inbox UI
The conversation list in `WhatsappInbox.tsx` shows a yellow "⏳ Awaiting address" badge next to any conversation whose `pending_button_intent.intent === "confirm"`.

## Files
- `supabase/functions/whatsapp-webhook/index.ts` — `applyOutcome` always gates confirm buttons; `tryExtractAndConfirmAddress` runs whenever a `pending_button_intent` exists; conv update clears `pending_button_intent` on success.
- `supabase/functions/whatsapp-automation-runner/index.ts` — `applyButtonAction` sets `forceAddressGate = wantsConfirm && !!order` (no address pre-check).
- `src/pages/whatsapp/WhatsappInbox.tsx` — "⏳ Awaiting address" pill in conversation list.

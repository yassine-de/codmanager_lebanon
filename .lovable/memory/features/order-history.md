---
name: Order History Tracking
description: Timeline logging for order changes — agents/admins, AI assistant, and WhatsApp customer actions
type: feature
---

The `order_history` table records all material changes to an order. The `OrderHistoryModal` displays them as a grouped, color-coded timeline (icon + actor + role badge + before→after deltas).

## Actor sources

- **Admin / Agent** — UI edits insert rows with `changed_by = auth.uid()` and `changed_by_role = 'admin' | 'agent'`. Profile name is resolved from `profiles`.
- **AI Assistant** — `whatsapp-webhook` `tryExtractAndConfirmAddress` writes a row when the AI auto-confirms an order from a complete delivery address. `action_type = 'ai_confirm'`, `changed_by_role = 'ai'`.
- **WhatsApp customer button** — `whatsapp-webhook` `applyOutcome` writes a row when the customer taps a Confirm / More info / Cancel button. `action_type = 'whatsapp_confirm' | 'whatsapp_more_info' | 'whatsapp_cancel'`, `changed_by_role = 'whatsapp'`.

## Sentinel UUID for non-user actors

Because `order_history.changed_by` is `uuid NOT NULL`, AI/WhatsApp/system entries use the sentinel `00000000-0000-0000-0000-000000000000`. The modal skips the `profiles` lookup for this id and labels the actor based on `changed_by_role` ("AI Assistant", "WhatsApp", "System").

## Grouped delta logging

`logOrderHistory` (in `whatsapp-webhook/index.ts`) snapshots a list of tracked fields BEFORE the order update, then inserts one row per field that actually changed, sharing a single `group_id` so the modal renders them as one event. Tracked field sets:

- AI auto-confirm: `confirmation_status, customer_address, customer_city, delivery_status, shipping_status`
- WhatsApp button: `confirmation_status, delivery_status, shipping_status, agent_id, note`

## UI mapping (`OrderHistoryModal.tsx`)

- `ai_confirm` → Sparkles icon, purple, message: "AI captured customer address & auto-confirmed order"
- `whatsapp_confirm` → MessageCircle icon, emerald, message: "Customer confirmed order via WhatsApp button"
- `whatsapp_cancel` → MessageCircle icon, destructive
- `whatsapp_more_info` → MessageCircle icon, blue

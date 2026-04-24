---
name: Confirmation Analytics Logic
description: Status analytics filtering on the Confirmation Analytics page is action-based, driven by order_history events (not orders.created_at).
type: feature
---

The Confirmation Analytics page (`src/pages/ConfirmationAnalytics.tsx`) bases ALL status analytics on `order_history` confirmation_status events, NOT on `orders.created_at`.

## Filtering rule (`statusActionsInPeriod`)

When a date range OR an agent filter is active, the page builds a map: `order_id → last status-change action matching the filters` from `order_history` rows where:
- `field_changed = 'confirmation_status'`
- `created_at` is inside the selected date range
- `changed_by` matches the selected agent (when agent filter is set)

Each filtered order's `confirmation_status` is then **overridden** by the status set by that action. Downstream sections (KPIs, cancel reasons, top products by confirmation/delivery, daily report, smart recommendations) all consume this overridden `filteredOrders`, so they reflect "what happened in the period" — not the order's current snapshot status.

When NO date filter and NO agent filter is set ("maximum" + "All Agents"), the page falls back to the orders' current status snapshot.

## Example

Filter: Today + Agent X + status = Cancelled
→ Returns orders where Agent X changed `confirmation_status` to `cancelled` today, even if the order was created on a previous day.

## What is NOT changed

- `orders.created_at` may still be used for "new orders created" metrics elsewhere.
- Invoice logic and order statuses themselves are untouched — this only affects the analytics view.

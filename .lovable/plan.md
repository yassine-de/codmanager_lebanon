

# Fix: Double-Counting Shipping Fees After Delivered→Shipped Revert

## Problem
When an order in a closed invoice changes from `delivered` → `shipped`, the adjustment trigger correctly creates a revenue reversal. However, the `get_invoice_summary` cross-invoice shipped query sees the new `shipped` event (logged in `order_history` when status changed) as a **new** shipment happening after the closed invoice's finalization — and counts it again in the open invoice's shipping fees.

The order was already shipped and billed in the closed invoice. The `delivered→shipped` revert is not a new shipment — it's just a status correction.

## Root Cause
The cross-invoice shipped query checks:
```
EXISTS (shipped event after inv_orig.finalized_at AND within current period)
```
When status changes from `delivered` to `shipped`, a new `order_history` entry is created with `new_value = 'shipped'`. This event falls after finalization, so the query picks it up as a "new cross-invoice shipment."

## Fix
In the `get_invoice_summary` function, add an exclusion to the **cross-invoice shipped** query (and corresponding parts of the **shipping breakdown** UNION ALL): skip orders that already had a `shipped` event **before or during** the original invoice period (`<= inv_orig.finalized_at`). If the order was already shipped in the closed invoice, any subsequent shipped events are not new shipments.

### Database Migration
Add this condition to the cross-invoice shipped CTE and the second half of the shipping breakdown UNION ALL:

```sql
-- Exclude orders that were already shipped within their original closed invoice period
AND NOT EXISTS (
  SELECT 1 FROM public.order_history oh_prev
  WHERE oh_prev.order_id = o.order_id
    AND oh_prev.field_changed = 'delivery_status'
    AND oh_prev.new_value = 'shipped'
    AND oh_prev.created_at <= inv_orig.finalized_at
)
```

This ensures only **genuinely new** cross-invoice shipments are counted — orders that were never shipped before the invoice was closed.

### Affected Queries (3 spots)
1. **Cross-invoice shipped CTE** — the `cross_shipped` WITH block
2. **Cross-delivered count** — no change needed (delivery events are separate)
3. **Shipping breakdown** — the second UNION ALL half (cross-invoice part)

### No Frontend Changes
The frontend reads `shipped_count` and `shipping_breakdown` from the summary — no code changes needed.

## Result
- Order shipped in closed invoice → delivered → reverted to shipped: **NOT** double-counted
- Genuinely new shipment after invoice close (never shipped before): **correctly counted**
- Adjustment for revenue reversal continues working as-is


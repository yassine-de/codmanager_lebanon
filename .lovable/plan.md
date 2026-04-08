

# Fix: Cross-Invoice Shipped Exclusion Too Aggressive

## Problem
BS-043 was shipped, then reverted to pending BEFORE its invoice (BS-INV-002) was finalized. The first shipping was never billed (same-period revert excluded it). After finalization, the order was shipped again — this IS a genuinely new shipment that should appear in BS-INV-003.

But the `NOT EXISTS (shipped before finalization)` filter blindly blocks any order that ever had a shipped event before finalization, regardless of whether that shipping was actually billed.

## Root Cause
The exclusion checks:
```sql
AND NOT EXISTS (
  oh_prev.new_value = 'shipped' AND oh_prev.created_at <= inv_orig.finalized_at
)
```
This is too broad. It should only exclude orders whose shipping was **actually billed** in the closed invoice — i.e., orders that were still in a shipped-like state when the invoice was finalized.

## Fix
Replace the "any shipped event before finalization" check with a "last delivery event before finalization was shipped-like" check. This way:
- Order shipped and still shipped at finalization → shipping was billed → **exclude** (no double-count)
- Order shipped then reverted to pending before finalization → shipping was NOT billed → **allow** (new shipment)

### New condition (replaces the current `NOT EXISTS` in 2 spots):
```sql
AND NOT EXISTS (
  SELECT 1 FROM public.order_history oh_prev
  WHERE oh_prev.order_id = o.order_id
    AND oh_prev.field_changed = 'delivery_status'
    AND oh_prev.created_at <= inv_orig.finalized_at
    AND oh_prev.created_at = (
      SELECT MAX(created_at) FROM public.order_history
      WHERE order_id = o.order_id
        AND field_changed = 'delivery_status'
        AND created_at <= inv_orig.finalized_at
    )
    AND oh_prev.new_value IN ('shipped','in_transit','with_courier','delivered','returned')
)
```

### Affected locations (2 spots in `get_invoice_summary`):
1. **Cross-shipped CTE** — the final `NOT EXISTS` clause
2. **Shipping breakdown UNION ALL** — the cross-invoice half's final `NOT EXISTS` clause

### No frontend changes needed.

## Result
- BS-043: shipped → pending (before close) → shipped (after close) → **correctly counted** as new shipment in open invoice
- Orders that were shipped and stayed shipped at close → still excluded (no double-counting)


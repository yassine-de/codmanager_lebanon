

# Fix: Shipping Fee Not Removed on Revert to Pending

## Problem
When an order is shipped (counted in shipping fees), then reverted to `pending`, the shipping fee remains because the shipped count logic only checks if a `shipped` event EXISTS in `order_history` — it doesn't verify the order's last delivery_status event is still a shipped state.

## Root Cause
The current shipped count query in `get_invoice_summary`:
```sql
AND EXISTS (
  SELECT 1 FROM public.order_history oh
  WHERE oh.order_id = o.order_id AND oh.field_changed = 'delivery_status' AND oh.new_value = 'shipped'
)
AND NOT EXISTS (
  -- only checks if shipped event was before period_start
  SELECT 1 FROM public.order_history oh2
  WHERE ... AND oh2.created_at <= v_period_start
)
```
It never checks if the order was **reverted** after being shipped.

## Fix
Apply the same "last event in period" pattern used for confirmations. For the shipped count (both direct and cross-invoice), add a `NOT EXISTS` clause that excludes orders whose **last** `delivery_status` event in the period is NOT a shipped state (`shipped`, `in_transit`, `with_courier`, `delivered`, `returned`).

### Database Migration

Update `get_invoice_summary` in three places:

#### 1. Direct shipped count
Add after the existing `NOT EXISTS`:
```sql
-- Exclude if last delivery_status event in period reverts to non-shipped
AND NOT EXISTS (
  SELECT 1 FROM public.order_history oh_last
  WHERE oh_last.order_id = o.order_id
    AND oh_last.field_changed = 'delivery_status'
    AND oh_last.created_at > v_period_start
    AND oh_last.created_at <= v_period_end
    AND oh_last.created_at = (
      SELECT MAX(created_at) FROM public.order_history
      WHERE order_id = o.order_id AND field_changed = 'delivery_status'
        AND created_at > v_period_start AND created_at <= v_period_end
    )
    AND oh_last.new_value NOT IN ('shipped','in_transit','with_courier','delivered','returned')
)
```

#### 2. Cross-invoice shipped query (same pattern)
Add the same `NOT EXISTS` clause to the cross-shipped CTE.

#### 3. Shipping breakdown query
Add the same `NOT EXISTS` clause to both halves of the `all_shipped` UNION ALL in the shipping breakdown.

### No Frontend Changes
The frontend already reads `shipped_count` and `shipping_breakdown` from the summary — no type changes needed.

## Result
- Order shipped then reverted to pending → removed from shipping fees
- Order shipped, reverted, then re-shipped → included (last event is shipped)
- Correct billing in all revert scenarios


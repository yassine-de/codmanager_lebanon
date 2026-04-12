

# Fix: Add Time Bounds to Direct-Invoice Shipping Queries

## Problem Found
Two queries in `get_invoice_summary` count shipped events for **direct invoice orders** without requiring the shipped event to fall within the invoice period (`v_period_start` to `v_period_end`). This means an order shipped in a previous or future period can be incorrectly counted.

### Affected Queries
1. **`v_shipped_count`** — the `EXISTS` subquery that detects a "shipped" event has no `created_at` time filter
2. **Shipping breakdown (first UNION half)** — same missing time filter on the `EXISTS` check

### What's Already Correct
- Cross-invoice shipped: ✅ time-bounded
- Cross-invoice confirmed: ✅ time-bounded  
- Direct-invoice confirmed: ✅ time-bounded
- Dropped count: ✅ uses `o.created_at` within period
- Cross-invoice delivered-only: ✅ time-bounded

## Fix (1 migration)

Add `AND oh.created_at > v_period_start AND oh.created_at <= v_period_end` to the initial `EXISTS` check in both locations. This replaces the current approach of "any shipped event exists + exclude pre-period ones" with a direct "shipped event exists within the period."

### Location 1: `v_shipped_count`
```sql
-- Current (no time filter on initial EXISTS):
AND EXISTS (
  SELECT 1 FROM public.order_history oh
  WHERE oh.order_id = o.order_id 
    AND oh.field_changed = 'delivery_status' 
    AND oh.new_value = 'shipped'
)

-- Fixed:
AND EXISTS (
  SELECT 1 FROM public.order_history oh
  WHERE oh.order_id = o.order_id 
    AND oh.field_changed = 'delivery_status' 
    AND oh.new_value = 'shipped'
    AND oh.created_at > v_period_start
    AND oh.created_at <= v_period_end
)
```

With this positive time filter, the second `NOT EXISTS` (excluding pre-period events) becomes redundant and can be removed for clarity.

### Location 2: Shipping breakdown first UNION half
Same change — add time bounds to the `EXISTS` check and remove the now-redundant `NOT EXISTS` for pre-period events.

### No frontend changes needed
The function output shape is unchanged. Only the correctness of which orders are counted is affected.


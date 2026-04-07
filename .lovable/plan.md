

# Fix: Event-Based Shipping Fee Logic

## Problem
The `get_invoice_summary` function uses `delivery_status = ANY(ARRAY['shipped','in_transit','with_courier','delivered','returned'])` to determine which orders incur shipping fees. This means a "returned" order that was already charged for shipping in a previous invoice gets charged again.

## Root Cause
Shipping is state-based (checks current `delivery_status`) instead of event-based (checks if the first "shipped" event occurred in this invoice's period).

## Solution

### Database Migration: Update `get_invoice_summary`

Replace all shipping-related queries that filter on current `delivery_status` with event-based detection using `order_history`.

**For direct invoice orders** (currently: `o.invoice_id = p_invoice_id AND o.delivery_status = ANY(v_shipped_statuses)`):

Change to: orders in this invoice that had their **first** `shipped` event during or before the invoice period:

```sql
-- Instead of checking current status, check for first shipped event
WHERE o.invoice_id = p_invoice_id
  AND EXISTS (
    SELECT 1 FROM public.order_history oh
    WHERE oh.order_id = o.order_id
      AND oh.field_changed = 'delivery_status'
      AND oh.new_value = 'shipped'
  )
  AND NOT EXISTS (
    -- Exclude if first shipped event was BEFORE this invoice's period
    SELECT 1 FROM public.order_history oh2
    WHERE oh2.order_id = o.order_id
      AND oh2.field_changed = 'delivery_status'
      AND oh2.new_value = 'shipped'
      AND oh2.created_at <= v_period_start
  )
```

**For cross-invoice shipped orders**: Already event-based but currently also filters on `o.delivery_status = ANY(v_shipped_statuses)` — remove that state filter since a returned order should still count if its shipped event falls in this period.

**Shipped count**: Update `v_shipped_count` query to use the same event-based logic.

**Unified shipping breakdown** (`all_shipped` CTE): Both halves (direct + cross) must use event-based detection instead of `delivery_status = ANY(v_shipped_statuses)`.

### Affected Queries (5 locations in `get_invoice_summary`)

| Query | Current (state-based) | New (event-based) |
|-------|----------------------|-------------------|
| `v_shipped_count` | `delivery_status = ANY(v_shipped_statuses)` | First shipped event in period |
| `all_shipped` CTE (direct half) | `delivery_status = ANY(v_shipped_statuses)` | First shipped event in period |
| `all_shipped` CTE (cross half) | `delivery_status = ANY(v_shipped_statuses)` | Already event-based, remove state filter |
| `cross_shipped` CTE | `delivery_status = ANY(v_shipped_statuses)` | Remove state filter, keep event check |
| Adjustment trigger | Uses `v_shipped_statuses` for reversal | No change needed (reversal is correct) |

### No Frontend Changes
The frontend already displays whatever `get_invoice_summary` returns. Only the database function changes.

### Files Changed

| Location | Change |
|----------|--------|
| DB Migration (new) | Rewrite shipping queries in `get_invoice_summary` to be event-based |

### What Is NOT Changed
- `create_invoice_adjustment_on_status_change` — shipping reversal logic remains correct (it creates adjustments for closed invoices)
- `auto_assign_invoice_on_delivery` — unchanged
- Frontend components — unchanged


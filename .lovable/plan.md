

# Event-Based Confirmation Fee Logic

## Summary
Replace state-based confirmation counting (`confirmation_status = 'confirmed'`) with event-based detection using `order_history`. Count one confirmation per order, only if a valid confirmation event exists in the invoice period.

## Database Migration: Update `get_invoice_summary`

### 1. Direct invoice confirmed count

**Current:**
```sql
SELECT COUNT(*) INTO v_invoice_confirmed_count
FROM public.orders WHERE invoice_id = p_invoice_id AND confirmation_status = 'confirmed';
```

**New:**
```sql
SELECT COUNT(*) INTO v_invoice_confirmed_count
FROM public.orders o
WHERE o.invoice_id = p_invoice_id
  AND EXISTS (
    SELECT 1 FROM public.order_history oh
    WHERE oh.order_id = o.order_id
      AND oh.field_changed = 'confirmation_status'
      AND oh.new_value = 'confirmed'
      AND oh.created_at > v_period_start
      AND oh.created_at <= v_period_end
  )
  AND NOT EXISTS (
    -- Exclude if the last confirmation_status event in this period is a revert (not 'confirmed')
    SELECT 1 FROM public.order_history oh_later
    WHERE oh_later.order_id = o.order_id
      AND oh_later.field_changed = 'confirmation_status'
      AND oh_later.created_at > v_period_start
      AND oh_later.created_at <= v_period_end
      AND oh_later.created_at = (
        SELECT MAX(oh_max.created_at) FROM public.order_history oh_max
        WHERE oh_max.order_id = o.order_id
          AND oh_max.field_changed = 'confirmation_status'
          AND oh_max.created_at > v_period_start
          AND oh_max.created_at <= v_period_end
      )
      AND oh_later.new_value != 'confirmed'
  );
```

This ensures:
- Counts only orders with a confirmation event in the period
- If confirmed then reverted in the same period → excluded (last event is not 'confirmed')
- If confirmed, reverted, then re-confirmed in the same period → included (last event is 'confirmed')

### 2. Cross-invoice confirmed count (new variable)

Add `v_cross_confirmed_count`:
```sql
SELECT COUNT(*) INTO v_cross_confirmed_count
FROM public.orders o
JOIN public.invoices inv_orig ON inv_orig.id = o.invoice_id
WHERE o.seller_id = v_invoice.seller_id
  AND o.invoice_id != p_invoice_id
  AND inv_orig.status IN ('ready','paid')
  AND inv_orig.finalized_at IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.order_history oh
    WHERE oh.order_id = o.order_id
      AND oh.field_changed = 'confirmation_status'
      AND oh.new_value = 'confirmed'
      AND oh.created_at > inv_orig.finalized_at
      AND oh.created_at > v_period_start
      AND oh.created_at <= v_period_end
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.order_history oh_later
    WHERE oh_later.order_id = o.order_id
      AND oh_later.field_changed = 'confirmation_status'
      AND oh_later.created_at > v_period_start
      AND oh_later.created_at <= v_period_end
      AND oh_later.created_at = (
        SELECT MAX(oh_max.created_at) FROM public.order_history oh_max
        WHERE oh_max.order_id = o.order_id
          AND oh_max.field_changed = 'confirmation_status'
          AND oh_max.created_at > v_period_start
          AND oh_max.created_at <= v_period_end
      )
      AND oh_later.new_value != 'confirmed'
  );
```

### 3. Update totals
```sql
v_confirmed_count := v_invoice_confirmed_count + v_cross_confirmed_count;
```

### 4. Return value
Add `'cross_confirmed_count', v_cross_confirmed_count` to the `counts` object.

## Frontend Type Update

**File:** `src/lib/invoice-summary.ts` — add `cross_confirmed_count: number` to `counts`.

## Files Changed

| Location | Change |
|----------|--------|
| DB Migration (new) | Event-based confirmation in `get_invoice_summary` |
| `src/lib/invoice-summary.ts` | Add `cross_confirmed_count` to types |

## What Is NOT Changed
- Dropped count formula — unchanged
- Adjustment trigger for confirmation — unchanged
- Frontend display — already uses `confirmed_count` from summary


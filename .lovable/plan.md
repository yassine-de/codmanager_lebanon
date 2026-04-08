

# Fix: Cross-Invoice Re-Delivered Orders Missing from Open Invoice

## Problem
When an order in a closed invoice goes `delivered → shipped → delivered`, the revenue is counted via `v_cross_delivered_revenue` but the order never appears in `v_delivered_orders`. The UI shows correct totals but the order is invisible in the delivered orders list.

## Root Cause
The `v_delivered_orders` list only gets cross-invoice orders from the `cross_shipped` CTE (filtered to `delivery_status = 'delivered'`). But `cross_shipped` excludes orders already shipped before close (our earlier fix). Re-delivered orders from closed invoices are therefore invisible — they have no dedicated path into `v_delivered_orders`.

## Fix: Add Dedicated Cross-Delivered Query

### Database Migration — Update `get_invoice_summary`

**1. Add a new `cross_delivered_only` CTE** (after the `cross_shipped` block, before revenue calc):

Query orders from closed invoices that:
- Belong to a `ready`/`paid` invoice
- Currently have `delivery_status = 'delivered'`
- Have a `delivered` event in `order_history` after `inv_orig.finalized_at` AND within `v_period_start..v_period_end`
- Use last-event-in-period logic: the last `delivery_status` event in the period must be `delivered` (prevents counting reverted orders)
- Exclude orders already in `cross_shipped` CTE (to avoid double-counting in both delivered list and shipping)

Build JSON from this CTE and append to `v_delivered_orders` and `v_all_orders`.

**2. Replace `v_cross_delivered_revenue`** — compute it from the `cross_delivered_only` CTE instead of the current standalone query. This ensures revenue matches the visible orders exactly and avoids double-counting with orders already captured via `cross_shipped`.

**3. Update `v_cross_delivered_count`** — derive from the same CTE.

**4. Update `v_delivered_count`** — add `cross_delivered_only` count.

### Key SQL Pattern (cross_delivered_only)
```sql
WITH cross_delivered_only AS (
  SELECT o.id, o.order_id, o.customer_name, ...
  FROM public.orders o
  JOIN public.invoices inv_orig ON inv_orig.id = o.invoice_id
  LEFT JOIN public.products p ON ...
  WHERE o.seller_id = v_invoice.seller_id
    AND o.invoice_id != p_invoice_id
    AND inv_orig.status IN ('ready','paid')
    AND inv_orig.finalized_at IS NOT NULL
    AND o.delivery_status = 'delivered'
    -- Has a delivered event after close, within period
    AND EXISTS (
      SELECT 1 FROM public.order_history oh
      WHERE oh.order_id = o.order_id
        AND oh.field_changed = 'delivery_status'
        AND oh.new_value = 'delivered'
        AND oh.created_at > inv_orig.finalized_at
        AND oh.created_at > v_period_start
        AND oh.created_at <= v_period_end
    )
    -- Last delivery event in period must be 'delivered'
    AND NOT EXISTS (
      SELECT 1 FROM public.order_history oh_last
      WHERE oh_last.order_id = o.order_id
        AND oh_last.field_changed = 'delivery_status'
        AND oh_last.created_at > v_period_start
        AND oh_last.created_at <= v_period_end
        AND oh_last.created_at = (
          SELECT MAX(created_at) FROM public.order_history
          WHERE order_id = o.order_id
            AND field_changed = 'delivery_status'
            AND created_at > v_period_start
            AND created_at <= v_period_end
        )
        AND oh_last.new_value != 'delivered'
    )
    -- Exclude orders already captured via cross_shipped
    AND NOT EXISTS (
      SELECT 1 FROM public.order_history oh_ship
      WHERE oh_ship.order_id = o.order_id
        AND oh_ship.field_changed = 'delivery_status'
        AND oh_ship.new_value = 'shipped'
        AND oh_ship.created_at > inv_orig.finalized_at
        AND oh_ship.created_at > v_period_start
        AND oh_ship.created_at <= v_period_end
        AND NOT EXISTS (
          SELECT 1 FROM public.order_history oh_prev
          WHERE oh_prev.order_id = o.order_id
            AND oh_prev.field_changed = 'delivery_status'
            AND oh_prev.new_value = 'shipped'
            AND oh_prev.created_at <= inv_orig.finalized_at
        )
    )
)
```

Orders from this CTE get `is_cross_invoice = true` and `original_invoice_number` set.

### No Frontend Changes
The Invoice Detail Modal already renders `delivered_orders` with `is_cross_invoice` badge support.

## Result
- Order stays in closed invoice (immutability preserved)
- Re-delivered order appears in open invoice's delivered orders list
- Revenue and delivered count match the visible list
- No double-counting between cross-shipped and cross-delivered
- Each delivered event counted once per period via last-event logic


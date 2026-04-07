

# Invoice System Refactor — Confirmed Plan

## Immutability Confirmation

The current `auto_assign_invoice_on_delivery` trigger already enforces the rule: orders in closed invoices are **never moved**. The trigger returns early with `RETURN NEW` (preserving `invoice_id`) when the linked invoice is `ready` or `paid`. No changes needed here.

## Changes to Implement

### 1. Database Migration: Fix `get_invoice_summary` — Add Period Bounds

The cross-invoice CTEs currently lack time bounds, causing events to appear in every subsequent invoice.

**Fix**: Add `AND oh.created_at > v_period_start AND oh.created_at <= v_period_end` to all 3 cross-invoice queries:
- `cross_shipped` CTE (orders + shipping)
- Cross delivered count query (for COD)
- Cross delivered revenue query

Also update the adjustment net calculation to include `shipping_difference`:
```sql
SUM(CASE WHEN status='approved' THEN difference + shipping_difference ELSE 0 END)
```

### 2. Database Migration: Enhance `create_invoice_adjustment_on_status_change`

Add shipping reversal handling — when an order in a closed invoice moves from a shipped status back to pending/cancelled:
- Calculate the old shipping fee from weight bracket
- Create adjustment with `shipping_difference = -old_shipping_fee`

Add price change handling — when `price` changes on a delivered order in a closed invoice:
- `difference = (new_price × new_qty) - (old_price × old_qty)`

### 3. Frontend: Update `src/lib/invoice-summary.ts`

Add `shipping_difference` and `shipping_difference_usd` fields to the `adjustments` array type.

### 4. Frontend: Update `src/components/InvoiceDetailModal.tsx`

Show revenue and shipping deltas separately in the adjustments display when both are non-zero.

## Files Changed

| Location | Change |
|----------|--------|
| DB Migration (new) | `get_invoice_summary`: period bounds + shipping_difference in net |
| DB Migration (new) | `create_invoice_adjustment_on_status_change`: shipping reversal + price change |
| `src/lib/invoice-summary.ts` | Add shipping_difference to adjustment type |
| `src/components/InvoiceDetailModal.tsx` | Display revenue + shipping deltas separately |

## What Is NOT Changed

- `auto_assign_invoice_on_delivery` — already correct, no reassignment from closed invoices
- `auto_assign_invoice_on_insert` — only assigns when `invoice_id IS NULL`
- Closed invoice data — never recomputed, only delta adjustments


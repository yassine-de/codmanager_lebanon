

# Remove Invoice ID / Financial Column from Orders UI

## Problem
The "Financial" column and its C/S/D dots are based on `invoice_id` linkage, which is no longer meaningful since revenue calculations are now event-based (shipped/delivered per invoice period). It creates confusion.

## Changes

### 1. `src/pages/Orders.tsx`
- Remove `'financial'` from the `ColumnKey` type and `allColumns` array
- Remove `filterFinancial` state and its filter UI block
- Remove `financial` from `appliedFilters`, `clearFilters`, `activeFilterCount`, and the filtering logic
- Remove `invoiceId`/`invoiceStatus` from the order mapping
- Remove the `invoices:invoice_id(status)` join in the Supabase query
- Remove the `<FinancialIndicators>` table cell and mobile rendering
- Remove the `FinancialIndicators` import

### 2. `src/components/FinancialIndicators.tsx`
- Delete the file entirely (no longer used anywhere after the Orders cleanup)

No database or migration changes needed.


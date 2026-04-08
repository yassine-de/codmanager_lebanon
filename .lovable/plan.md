

# Remove Warehouse Filter & Edit Fields

## Changes

### 1. Orders page (`src/pages/Orders.tsx`)
- Remove the "Warehouse" filter dropdown (lines ~622-634) and all related state/logic (`filterWarehouse`, `setFilterWarehouse`, references in `appliedFilters`, `clearFilters`, `activeFilterCount`, and the filter function).

### 2. Edit Order modal (`src/components/EditOrderModal.tsx`)
- Remove the "Seller" field (lines 268-275) from the Order Status section.
- Remove the "Warehouse" field (lines 277-287) from the Order Status section.
- Remove the `seller` state variable and its usage in `useEffect`/`onSave`.
- Remove the `warehouseState` state variable and its usage in `useEffect`/`onSave`.

### 3. Orders page — data mapping
- Remove `warehouseState` from the order mapping object (line ~314).

No database changes needed — these are purely UI removals of fields that aren't backed by real DB columns.


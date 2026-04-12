

# Add ORIO ID Column with Tracking Popup

## Overview
Add a clickable "ORIO ID" column (admin-only) after "Seller ID" in the Orders table. Clicking it opens a modal showing tracking details from the ORIO Track API.

## Changes

### 1. Update `Order` interface (`src/lib/data.ts`)
Add `orioOrderId?: number | null` to the Order interface.

### 2. Update data mapping (`src/pages/Orders.tsx`)
- Map `orio_order_id` from the DB query to `orioOrderId` on the Order object
- Add `'orioId'` to `ColumnKey` type and `allColumns` array (after `'id'`, admin-only)
- Add table header for "ORIO ID"
- Add table cell: if `orioOrderId` exists, render it as a clickable link (blue, underlined). On click, stop propagation and open tracking modal.

### 3. Create `OrioTrackingModal` component (`src/components/OrioTrackingModal.tsx`)
- Props: `orioOrderId: number`, `open: boolean`, `onClose: () => void`
- On open, call the `orio-sync` edge function with `action: "track"` and `order_id`
- Display a dialog styled like the screenshot:
  - Header: "TRACK DETAIL - {consignment_no}"
  - Summary row: STATUS, CN#, DATE, CUSTOMER, COD, FROM TO (from `payload` fields)
  - "COURIER SHIPPING LABEL: {consignment_no}"
  - Timeline of events from `payload.detail[]` array, each showing `dateTime` and `status`
- Loading and error states

### 4. Update edge function tracking (`supabase/functions/orio-sync/index.ts`)
The existing `trackShipment` function sends `order_id` (the ORIO numeric ID) but expects a DB UUID as input. Need to adjust:
- Accept ORIO order ID directly for tracking (add a new action `track-by-orio-id` or modify `track` to accept `orio_order_id`)
- The track API response (from docs) returns: `payload.order_id`, `payload.status`, `payload.consigment_no`, `payload.order_date`, `payload.consignee_name`, `payload.cod_amount`, `payload.shipping_charges`, `payload.origin`, `payload.destination`, `payload.detail[]` (array of `{dateTime, status}`)
- Return full payload to the frontend

### Technical Details
- Track API: `POST https://apis.orio.digital/api/track` with `{order_id: <integer>, acno: "OR-04820"}`
- Response: array with `[{status: "1", message: "success", payload: {order_id, status, consigment_no, detail: [{dateTime, status}]}}]`
- The `order_id` parameter must be an integer (the ORIO order ID stored in `orders.orio_order_id`)


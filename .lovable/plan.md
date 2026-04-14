

## ORIO Status-Sync Background Service – Implementation Plan

### Overview
Create a background service that automatically syncs delivery statuses from the ORIO API every 5 minutes, updating orders in the database without any frontend performance impact.

### Steps

**Step 1: Database Migration**
- Enable `pg_cron` and `pg_net` extensions
- Insert `orio_sync_interval_minutes` = `5` and `orio_last_status_sync` = `''` into `app_settings`

**Step 2: Create Edge Function `orio-status-sync`**
- New file: `supabase/functions/orio-status-sync/index.ts`
- Fetches orders where `orio_order_id IS NOT NULL` and `delivery_status NOT IN ('delivered', 'returned', 'cancelled')` (limit 50)
- Checks `orio_api_enabled` setting before proceeding
- For each order: calls ORIO `POST /api/track` with `{ order_id, acno }` using same auth pattern as `orio-sync`
- Status mapping:
  - `In Transit` → `Shipped`
  - `Delivered` → `Delivered` + sets `delivered_at = now()`
  - `Return` → `Returned`
  - `Cancelled` → `Cancelled`
  - `Failed Attempt` → `Failed`
- Only updates when status has actually changed
- Stores raw ORIO status in `orio_shipping_status`
- Updates `orio_last_status_sync` timestamp after each run
- Uses `SUPABASE_SERVICE_ROLE_KEY`, includes CORS headers
- Logs errors per order without aborting the batch

**Step 3: Cron Job (SQL Insert via insert tool)**
- Create `pg_cron` job calling the edge function every 5 minutes via `net.http_post`
- Uses project Supabase URL and anon key

**Step 4: Update StatusBadge / data types**
- Add `'failed'` to `OrderStatus` and `DeliveryStatus` types in `src/lib/data.ts`
- Add `failed` entry to `statusConfig` with orange styling

**Step 5: Settings/Integrations UI update**
- In `src/pages/Integrations.tsx`, add to the ORIO API section:
  - Sync interval input field (minutes) reading/writing `orio_sync_interval_minutes`
  - Display last sync timestamp from `orio_last_status_sync`
  - Load both values alongside existing API config

### Technical Details
- The edge function runs entirely server-side via pg_cron → no frontend impact
- `delivery_status` is a text field, no enum migration needed
- The cron job uses `net.http_post` with the anon key in the Authorization header
- Error handling: each order tracked independently, failures logged but don't stop the batch


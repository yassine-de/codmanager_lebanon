ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS wakilni_order_id text,
  ADD COLUMN IF NOT EXISTS wakilni_tracking_id text,
  ADD COLUMN IF NOT EXISTS wakilni_bulk_id text,
  ADD COLUMN IF NOT EXISTS wakilni_sync_status text,
  ADD COLUMN IF NOT EXISTS wakilni_sync_error text,
  ADD COLUMN IF NOT EXISTS wakilni_synced_at timestamptz,
  ADD COLUMN IF NOT EXISTS wakilni_response jsonb;

CREATE INDEX IF NOT EXISTS idx_orders_wakilni_sync_status
  ON public.orders (wakilni_sync_status);

INSERT INTO public.app_settings (key, value)
VALUES ('wakilni_api_enabled', 'true')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

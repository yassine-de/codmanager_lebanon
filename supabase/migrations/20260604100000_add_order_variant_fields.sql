ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS variant_name text,
  ADD COLUMN IF NOT EXISTS variant_sku text;

CREATE INDEX IF NOT EXISTS idx_orders_variant_sku
  ON public.orders (variant_sku);

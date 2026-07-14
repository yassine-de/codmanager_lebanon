-- Seller sheet order IDs are not globally unique. The internal unique identifier is
-- orders.system_id/id; imports detect duplicates by sheet + phone + SKU.

ALTER TABLE public.orders
  DROP CONSTRAINT IF EXISTS orders_order_id_key;

DROP INDEX IF EXISTS public.orders_order_id_key;

CREATE INDEX IF NOT EXISTS idx_orders_source_sheet_phone_sku
  ON public.orders (source_sheet_id, customer_phone, variant_sku);

NOTIFY pgrst, 'reload schema';

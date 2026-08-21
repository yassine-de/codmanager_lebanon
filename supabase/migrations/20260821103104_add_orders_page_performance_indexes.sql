-- Support server-side filtering, sorting, pagination, and text search on the Orders page.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_orders_created_id_desc
  ON public.orders (created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_orders_updated_id_desc
  ON public.orders (updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_orders_system_id_id_desc
  ON public.orders (system_id DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_orders_delivery_created
  ON public.orders (delivery_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_seller_created
  ON public.orders (seller_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_agent_created
  ON public.orders (agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_original_agent_created
  ON public.orders (original_agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_seller_confirmation_created
  ON public.orders (seller_id, confirmation_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_seller_delivery_created
  ON public.orders (seller_id, delivery_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_channel_created
  ON public.orders (confirmation_channel, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_substatus_created
  ON public.orders (orio_shipping_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_customer_name_trgm
  ON public.orders USING gin (customer_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_orders_customer_phone_trgm
  ON public.orders USING gin (customer_phone gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_orders_customer_city_trgm
  ON public.orders USING gin (customer_city gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_orders_product_name_trgm
  ON public.orders USING gin (product_name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_orders_wakilni_order_id_trgm
  ON public.orders USING gin (wakilni_order_id gin_trgm_ops);

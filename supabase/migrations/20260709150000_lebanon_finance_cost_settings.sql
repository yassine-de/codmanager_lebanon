INSERT INTO public.app_settings (key, value, updated_at)
VALUES
  ('lebanon_packaging_cost_usd', '0.25', now()),
  ('lebanon_warehouse_rental_monthly_usd', '0', now())
ON CONFLICT (key) DO NOTHING;

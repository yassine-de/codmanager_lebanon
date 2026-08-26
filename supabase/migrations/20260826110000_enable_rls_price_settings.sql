-- Protect legacy price_settings from browser/API access.
-- The current COD Lebanon app does not read this table directly.
--
-- Rollback:
--   ALTER TABLE public.price_settings DISABLE ROW LEVEL SECURITY;

ALTER TABLE public.price_settings ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

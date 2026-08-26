-- Protect legacy offers data from browser/API access.
-- This table contains customer contact and project details and is not used
-- directly by the current COD Lebanon app.
--
-- Rollback:
--   ALTER TABLE public.offers DISABLE ROW LEVEL SECURITY;

ALTER TABLE public.offers ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

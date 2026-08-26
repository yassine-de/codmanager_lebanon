ALTER TABLE public.price_settings DISABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

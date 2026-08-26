ALTER TABLE public.offers DISABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

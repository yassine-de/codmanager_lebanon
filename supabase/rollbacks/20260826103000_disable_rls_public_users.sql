ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

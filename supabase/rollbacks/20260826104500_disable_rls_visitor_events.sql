ALTER TABLE public.visitor_events DISABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

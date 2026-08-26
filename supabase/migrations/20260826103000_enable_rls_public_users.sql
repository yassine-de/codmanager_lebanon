-- Protect legacy public.users from browser/API access.
-- The active app uses auth.users/profiles/user_roles; service-role Edge Functions
-- can still access this table if needed.
--
-- Rollback:
--   ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

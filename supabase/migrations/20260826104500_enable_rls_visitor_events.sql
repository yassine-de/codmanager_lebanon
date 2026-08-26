-- Protect visitor tracking data from browser/API access.
-- This table contains IP, referrer, path, and user-agent information.
--
-- Rollback:
--   ALTER TABLE public.visitor_events DISABLE ROW LEVEL SECURITY;

ALTER TABLE public.visitor_events ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

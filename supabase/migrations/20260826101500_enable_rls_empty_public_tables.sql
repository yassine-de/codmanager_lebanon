-- First low-risk RLS step: these tables are currently empty and unused by the COD app.
-- Rollback:
--   ALTER TABLE public.appointments DISABLE ROW LEVEL SECURITY;
--   ALTER TABLE public.callbacks DISABLE ROW LEVEL SECURITY;

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.callbacks ENABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

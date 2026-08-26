ALTER TABLE public.appointments DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.callbacks DISABLE ROW LEVEL SECURITY;

NOTIFY pgrst, 'reload schema';

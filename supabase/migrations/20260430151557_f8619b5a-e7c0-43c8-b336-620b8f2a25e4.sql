REVOKE EXECUTE ON FUNCTION public.get_follow_ups_data() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_follow_ups_data() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_follow_ups_data() TO authenticated;
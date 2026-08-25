CREATE OR REPLACE FUNCTION public.touch_user_presence()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO public.user_presence (user_id, last_seen, is_active)
  VALUES (auth.uid(), now(), true)
  ON CONFLICT (user_id)
  DO UPDATE SET
    last_seen = now(),
    is_active = true;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_user_presence_inactive()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE public.user_presence
  SET last_seen = now(),
      is_active = false
  WHERE user_id = auth.uid();
END;
$$;

GRANT EXECUTE ON FUNCTION public.touch_user_presence() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_user_presence_inactive() TO authenticated;

NOTIFY pgrst, 'reload schema';


CREATE OR REPLACE FUNCTION public.release_expired_order_locks()
 RETURNS void
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
  UPDATE orders
  SET agent_id = NULL, assigned_at = NULL, last_activity_at = NULL
  WHERE agent_id IS NOT NULL
    AND confirmation_status = 'new'
    AND last_activity_at IS NOT NULL
    AND last_activity_at < now() - interval '5 minutes';
$$;

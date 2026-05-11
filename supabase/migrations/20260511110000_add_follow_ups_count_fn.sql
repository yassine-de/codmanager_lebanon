-- Returns the total number of orders visible to the current user in Follow Ups,
-- using the same auth + delivery_status logic as get_follow_ups_data().
-- Used by the frontend to show the real "All orders" count without hitting row limits.

CREATE OR REPLACE FUNCTION public.get_follow_ups_count()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid       uuid    := auth.uid();
  v_is_admin  boolean := public.is_admin(v_uid);
  v_is_fu     boolean := public.has_role(v_uid, 'follow_up'::app_role);
  v_is_agent  boolean := public.has_role(v_uid, 'agent'::app_role);
  v_count     bigint;
BEGIN
  IF NOT (v_is_admin OR v_is_agent OR v_is_fu) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT COUNT(*) INTO v_count
  FROM public.orders o
  WHERE o.delivery_status IN (
    'shipped', 'in_transit', 'out_for_delivery', 'with_courier',
    'delivered', 'failed_attempt', 'returned', 'return', 'ready_for_return'
  )
  AND (
    v_is_admin
    OR (v_is_fu    AND o.follow_up_assigned_to = v_uid)
    OR (v_is_agent AND o.agent_id = v_uid)
  );

  RETURN v_count;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.get_follow_ups_count() TO authenticated, anon, service_role;

NOTIFY pgrst, 'reload schema';

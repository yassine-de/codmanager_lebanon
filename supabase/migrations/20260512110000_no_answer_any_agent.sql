-- Allow any agent to claim any no_answer order (remove original_agent_id restriction).
-- Raise max attempts from 9 → 12 before auto-converting to unreachable.
-- Add reclaim_no_answer_order() RPC so original agent can handle customer callbacks.

-- 1. Recreate claim_next_order with updated no_answer branch
CREATE OR REPLACE FUNCTION public.claim_next_order(p_agent_id uuid, p_order_type text DEFAULT 'new', p_product_names text[] DEFAULT NULL)
RETURNS SETOF orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM release_expired_order_locks();

  IF p_order_type = 'new' THEN
    RETURN QUERY
    WITH picked AS (
      SELECT o.id
      FROM orders o
      WHERE o.confirmation_status = 'new'
        AND o.agent_id IS NULL
        AND (p_product_names IS NULL OR o.product_name = ANY(p_product_names))
      ORDER BY o.created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE orders o2
    SET agent_id = p_agent_id, assigned_at = now(), last_activity_at = now(), updated_at = now()
    FROM picked
    WHERE o2.id = picked.id
    RETURNING o2.*;

  ELSIF p_order_type = 'no_answer' THEN
    RETURN QUERY
    WITH picked AS (
      SELECT o.id
      FROM orders o
      WHERE o.confirmation_status = 'no_answer'
        AND o.agent_id IS NULL
        -- any agent can claim any no_answer order (removed original_agent_id restriction)
        AND o.attempt_count < 12
        AND (o.last_attempt_at IS NULL OR o.last_attempt_at <= now() - interval '30 minutes')
        AND (
          o.last_attempt_date IS DISTINCT FROM CURRENT_DATE
          OR o.attempts_today < 4
        )
        AND (p_product_names IS NULL OR o.product_name = ANY(p_product_names))
      ORDER BY o.last_attempt_at ASC NULLS FIRST
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE orders o2
    SET agent_id = p_agent_id, assigned_at = now(), last_activity_at = now(), updated_at = now()
    FROM picked
    WHERE o2.id = picked.id
    RETURNING o2.*;

  ELSIF p_order_type = 'postponed' THEN
    RETURN QUERY
    WITH picked AS (
      SELECT o.id
      FROM orders o
      WHERE o.confirmation_status = 'postponed'
        AND o.agent_id IS NULL
        AND o.postpone_date <= now()
        AND o.original_agent_id = p_agent_id
        AND (p_product_names IS NULL OR o.product_name = ANY(p_product_names))
      ORDER BY o.postpone_date ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE orders o2
    SET agent_id = p_agent_id, assigned_at = now(), last_activity_at = now(), updated_at = now()
    FROM picked
    WHERE o2.id = picked.id
    RETURNING o2.*;

    IF NOT FOUND THEN
      RETURN QUERY
      WITH picked AS (
        SELECT o.id
        FROM orders o
        WHERE o.confirmation_status = 'postponed'
          AND o.agent_id IS NULL
          AND o.postpone_date <= now()
          AND o.original_agent_id IS DISTINCT FROM p_agent_id
          AND NOT EXISTS (
            SELECT 1 FROM user_presence up
            WHERE up.user_id = o.original_agent_id
              AND up.is_active = true
              AND up.last_seen > now() - interval '10 minutes'
          )
          AND (p_product_names IS NULL OR o.product_name = ANY(p_product_names))
        ORDER BY o.postpone_date ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE orders o2
      SET agent_id = p_agent_id, assigned_at = now(), last_activity_at = now(), updated_at = now()
      FROM picked
      WHERE o2.id = picked.id
      RETURNING o2.*;
    END IF;

  ELSIF p_order_type = 'duplicate' THEN
    RETURN QUERY
    WITH first_dup AS (
      SELECT o.customer_phone, o.product_name
      FROM orders o
      WHERE o.confirmation_status = 'new'
        AND o.agent_id IS NULL
        AND (p_product_names IS NULL OR o.product_name = ANY(p_product_names))
      GROUP BY o.customer_phone, o.product_name
      HAVING COUNT(*) > 1
      LIMIT 1
    ),
    picked AS (
      SELECT o.id
      FROM orders o
      INNER JOIN first_dup fd ON o.customer_phone = fd.customer_phone AND o.product_name = fd.product_name
      WHERE o.confirmation_status = 'new'
        AND o.agent_id IS NULL
      FOR UPDATE SKIP LOCKED
    )
    UPDATE orders o2
    SET agent_id = p_agent_id, assigned_at = now(), last_activity_at = now(), updated_at = now()
    FROM picked
    WHERE o2.id = picked.id
    RETURNING o2.*;
  END IF;
END;
$$;

-- 2. Add reclaim_no_answer_order: lets original agent claim back a specific
--    unassigned no_answer order when a customer calls them back directly.
CREATE OR REPLACE FUNCTION public.reclaim_no_answer_order(p_order_id uuid)
RETURNS SETOF orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agent_id uuid := auth.uid();
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT o.id
    FROM orders o
    WHERE o.id = p_order_id
      AND o.confirmation_status = 'no_answer'
      AND o.agent_id IS NULL
      AND o.original_agent_id = v_agent_id
    FOR UPDATE SKIP LOCKED
  )
  UPDATE orders o2
  SET agent_id = v_agent_id, assigned_at = now(), last_activity_at = now(), updated_at = now()
  FROM picked
  WHERE o2.id = picked.id
  RETURNING o2.*;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reclaim_no_answer_order(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

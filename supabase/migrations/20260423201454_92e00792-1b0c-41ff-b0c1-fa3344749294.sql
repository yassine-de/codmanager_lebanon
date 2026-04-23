
-- 1. Extend whatsapp_automation_runs to support paused/waiting states
ALTER TABLE public.whatsapp_automation_runs
  ADD COLUMN IF NOT EXISTS current_node_id text,
  ADD COLUMN IF NOT EXISTS state jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS wait_until timestamptz,
  ADD COLUMN IF NOT EXISTS conversation_id uuid;

-- Useful indexes
CREATE INDEX IF NOT EXISTS whatsapp_automation_runs_status_wait_idx
  ON public.whatsapp_automation_runs (status, wait_until);
CREATE INDEX IF NOT EXISTS whatsapp_automation_runs_conv_status_idx
  ON public.whatsapp_automation_runs (conversation_id, status);
CREATE INDEX IF NOT EXISTS whatsapp_automation_runs_order_status_idx
  ON public.whatsapp_automation_runs (order_id, status);

-- Allowed run statuses: running, waiting_reply, waiting_delay, completed, failed, cancelled

-- 2. Make sure pg_net is available (used to invoke the edge function)
CREATE EXTENSION IF NOT EXISTS pg_net;

-- 3. Trigger function: on new order, invoke the runner only when product has whatsapp_confirmation_enabled
CREATE OR REPLACE FUNCTION public.trigger_whatsapp_new_order_automation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
  v_anon text;
  v_enabled boolean;
BEGIN
  -- Read project URL + anon key from app_settings (must be configured)
  SELECT value INTO v_url FROM public.app_settings WHERE key = 'project_url' LIMIT 1;
  SELECT value INTO v_anon FROM public.app_settings WHERE key = 'project_anon_key' LIMIT 1;

  IF v_url IS NULL OR v_anon IS NULL THEN
    RETURN NEW; -- silently skip if not configured yet
  END IF;

  -- Resolve whether this order's product has whatsapp_confirmation_enabled
  SELECT COALESCE(p.whatsapp_confirmation_enabled, false)
    INTO v_enabled
  FROM public.products p
  WHERE p.seller_id = NEW.seller_id
    AND p.name = NEW.product_name
  ORDER BY p.created_at DESC
  LIMIT 1;

  IF NOT COALESCE(v_enabled, false) THEN
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := v_url || '/functions/v1/whatsapp-automation-runner',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_anon
    ),
    body := jsonb_build_object(
      'trigger_type', 'new_order',
      'order_id', NEW.order_id
    )
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_whatsapp_new_order_automation ON public.orders;
CREATE TRIGGER trg_whatsapp_new_order_automation
AFTER INSERT ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.trigger_whatsapp_new_order_automation();

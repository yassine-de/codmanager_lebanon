-- Fix duplicate-order WhatsApp alert:
--   1. Use mode='note' → internal message, no Meta API call, no 24h window required.
--   2. Alert BOTH the new order AND every existing duplicate order so all conversations see the warning.

CREATE OR REPLACE FUNCTION public.trigger_duplicate_order_whatsapp_alert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url     text;
  v_anon    text;
  v_dup     RECORD;
  v_msg_new text;
  v_msg_old text;
BEGIN
  -- Read project URL + anon key from app_settings
  SELECT value INTO v_url  FROM public.app_settings WHERE key = 'project_url'      LIMIT 1;
  SELECT value INTO v_anon FROM public.app_settings WHERE key = 'project_anon_key' LIMIT 1;

  IF v_url IS NULL OR v_anon IS NULL THEN
    RETURN NEW;
  END IF;

  -- Find all existing orders for the same phone + product (any status, excluding this row)
  FOR v_dup IN
    SELECT order_id
    FROM   public.orders
    WHERE  customer_phone = NEW.customer_phone
      AND  product_name   = NEW.product_name
      AND  id            != NEW.id
    ORDER BY created_at DESC
  LOOP
    -- Alert on the NEW (just-inserted) order
    v_msg_new := '⚠️ Duplicate order detected. This customer already has an existing order for the same product: '
               || v_dup.order_id
               || '. Please verify before proceeding.';

    PERFORM net.http_post(
      url     := v_url || '/functions/v1/whatsapp-send',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_anon
      ),
      body    := jsonb_build_object(
        'order_id', NEW.order_id,
        'mode',     'note',
        'body',     v_msg_new
      )
    );

    -- Also alert on the ORIGINAL (existing) order so its conversation is notified too
    v_msg_old := '⚠️ Duplicate order detected. A new order ' || NEW.order_id
               || ' was just created for the same customer and product. Please verify before proceeding.';

    PERFORM net.http_post(
      url     := v_url || '/functions/v1/whatsapp-send',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_anon
      ),
      body    := jsonb_build_object(
        'order_id', v_dup.order_id,
        'mode',     'note',
        'body',     v_msg_old
      )
    );
  END LOOP;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never block the insert — silently swallow errors
  RETURN NEW;
END;
$$;

-- Re-create trigger (idempotent)
DROP TRIGGER IF EXISTS trg_duplicate_order_whatsapp_alert ON public.orders;
CREATE TRIGGER trg_duplicate_order_whatsapp_alert
  AFTER INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_duplicate_order_whatsapp_alert();

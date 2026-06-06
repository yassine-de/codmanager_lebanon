-- Lebanon invoice assignment rule:
-- Only delivered orders belong to the current open invoice.
-- Confirmation-only, booked, shipped, cancelled, and new orders must stay outside invoices.

CREATE OR REPLACE FUNCTION public.auto_assign_invoice_on_delivery()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_open_invoice_id uuid;
  v_new_invoice_id uuid;
  v_current_invoice_status text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.delivery_status = 'delivered' AND NEW.invoice_id IS NULL THEN
      PERFORM pg_advisory_xact_lock(hashtext(NEW.seller_id::text));

      SELECT id
      INTO v_open_invoice_id
      FROM public.invoices
      WHERE seller_id = NEW.seller_id
        AND status = 'open'
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE;

      IF v_open_invoice_id IS NOT NULL THEN
        NEW.invoice_id := v_open_invoice_id;
      ELSE
        INSERT INTO public.invoices (seller_id, status)
        VALUES (NEW.seller_id, 'open')
        RETURNING id INTO v_new_invoice_id;

        NEW.invoice_id := v_new_invoice_id;
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.delivery_status = 'delivered'
     AND OLD.delivery_status IS DISTINCT FROM 'delivered' THEN
    IF NEW.invoice_id IS NOT NULL THEN
      SELECT status
      INTO v_current_invoice_status
      FROM public.invoices
      WHERE id = NEW.invoice_id;

      IF v_current_invoice_status IN ('ready', 'paid') THEN
        RETURN NEW;
      END IF;
    END IF;

    IF NEW.invoice_id IS NULL THEN
      PERFORM pg_advisory_xact_lock(hashtext(NEW.seller_id::text));

      SELECT id
      INTO v_open_invoice_id
      FROM public.invoices
      WHERE seller_id = NEW.seller_id
        AND status = 'open'
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE;

      IF v_open_invoice_id IS NOT NULL THEN
        NEW.invoice_id := v_open_invoice_id;
      ELSE
        INSERT INTO public.invoices (seller_id, status)
        VALUES (NEW.seller_id, 'open')
        RETURNING id INTO v_new_invoice_id;

        NEW.invoice_id := v_new_invoice_id;
      END IF;
    END IF;
  ELSIF OLD.delivery_status = 'delivered'
     AND NEW.delivery_status IS DISTINCT FROM 'delivered'
     AND NEW.invoice_id IS NOT NULL THEN
    SELECT status
    INTO v_current_invoice_status
    FROM public.invoices
    WHERE id = NEW.invoice_id;

    IF v_current_invoice_status = 'open' THEN
      NEW.invoice_id := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.auto_assign_invoice_on_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_open_invoice_id uuid;
  v_new_invoice_id uuid;
BEGIN
  IF NEW.delivery_status = 'delivered' AND NEW.invoice_id IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(NEW.seller_id::text));

    SELECT id
    INTO v_open_invoice_id
    FROM public.invoices
    WHERE seller_id = NEW.seller_id
      AND status = 'open'
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_open_invoice_id IS NOT NULL THEN
      NEW.invoice_id := v_open_invoice_id;
    ELSE
      INSERT INTO public.invoices (seller_id, status)
      VALUES (NEW.seller_id, 'open')
      RETURNING id INTO v_new_invoice_id;

      NEW.invoice_id := v_new_invoice_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_auto_assign_invoice ON public.orders;
DROP TRIGGER IF EXISTS trg_auto_assign_invoice_on_insert ON public.orders;
DROP TRIGGER IF EXISTS auto_assign_invoice_trigger ON public.orders;

CREATE TRIGGER auto_assign_invoice_trigger
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_assign_invoice_on_delivery();

UPDATE public.orders o
SET invoice_id = NULL
FROM public.invoices i
WHERE o.invoice_id = i.id
  AND i.status = 'open'
  AND COALESCE(o.delivery_status, '') <> 'delivered';

NOTIFY pgrst, 'reload schema';

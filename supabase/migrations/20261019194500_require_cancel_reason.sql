CREATE OR REPLACE FUNCTION public.require_cancel_reason()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.confirmation_status = 'cancelled'
     AND (TG_OP = 'INSERT' OR OLD.confirmation_status IS DISTINCT FROM 'cancelled')
     AND NULLIF(BTRIM(NEW.cancel_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A cancellation reason is required when cancelling an order.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS require_cancel_reason_on_orders ON public.orders;

CREATE TRIGGER require_cancel_reason_on_orders
BEFORE INSERT OR UPDATE OF confirmation_status, cancel_reason ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.require_cancel_reason();

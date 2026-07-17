-- Keep orders.updated_at as the timestamp of the last meaningful order change.
-- Background Wakilni polling updates sync metadata frequently; those updates should
-- not make old orders look newly edited in the Orders table.

CREATE OR REPLACE FUNCTION public.update_orders_updated_at_meaningful()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_old jsonb;
  v_new jsonb;
BEGIN
  v_old := to_jsonb(OLD)
    - 'updated_at'
    - 'wakilni_synced_at'
    - 'wakilni_sync_status'
    - 'wakilni_sync_error'
    - 'wakilni_response';

  v_new := to_jsonb(NEW)
    - 'updated_at'
    - 'wakilni_synced_at'
    - 'wakilni_sync_status'
    - 'wakilni_sync_error'
    - 'wakilni_response';

  IF v_new IS DISTINCT FROM v_old THEN
    NEW.updated_at := now();
  ELSIF NEW.updated_at IS DISTINCT FROM OLD.updated_at THEN
    NEW.updated_at := NEW.updated_at;
  ELSE
    NEW.updated_at := OLD.updated_at;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_orders_updated_at ON public.orders;

CREATE TRIGGER update_orders_updated_at
BEFORE UPDATE ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.update_orders_updated_at_meaningful();

NOTIFY pgrst, 'reload schema';

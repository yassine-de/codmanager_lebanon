
-- Create function to auto-trigger ORIO sync when order is confirmed
CREATE OR REPLACE FUNCTION public.trigger_orio_sync_on_confirm()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Only trigger when status changes TO confirmed
  IF NEW.confirmation_status = 'confirmed'
     AND (OLD.confirmation_status IS DISTINCT FROM 'confirmed')
     AND (NEW.orio_order_id IS NULL)
     AND (NEW.orio_sync_status IS DISTINCT FROM 'synced')
  THEN
    -- Set sync status to pending
    NEW.orio_sync_status := 'pending';

    -- Call edge function asynchronously via pg_net
    PERFORM net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1) || '/functions/v1/orio-sync',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'SUPABASE_SERVICE_ROLE_KEY' LIMIT 1)
      ),
      body := jsonb_build_object('action', 'sync-order', 'order_id', NEW.id::text)
    );
  END IF;
  RETURN NEW;
END;
$function$;

-- Attach trigger to orders table
DROP TRIGGER IF EXISTS trg_orio_sync_on_confirm ON public.orders;
CREATE TRIGGER trg_orio_sync_on_confirm
  BEFORE UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_orio_sync_on_confirm();

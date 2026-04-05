
CREATE OR REPLACE FUNCTION public.log_invoice_order_assignment()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
BEGIN
  -- Order added to an invoice
  IF OLD.invoice_id IS DISTINCT FROM NEW.invoice_id THEN
    -- Log OUT from old invoice
    IF OLD.invoice_id IS NOT NULL THEN
      INSERT INTO public.invoice_history (
        invoice_id, event_type, field_changed,
        old_value, new_value, order_id, changed_by,
        description, metadata
      ) VALUES (
        OLD.invoice_id, 'order_removed', 'invoice_id',
        OLD.invoice_id::text, COALESCE(NEW.invoice_id::text, 'none'),
        NEW.order_id, auth.uid(),
        'Order ' || NEW.order_id || ' removed from invoice',
        jsonb_build_object(
          'product_name', NEW.product_name,
          'quantity', NEW.quantity,
          'price', NEW.price,
          'confirmation_status', NEW.confirmation_status,
          'delivery_status', COALESCE(NEW.delivery_status, 'none')
        )
      );
    END IF;

    -- Log IN to new invoice
    IF NEW.invoice_id IS NOT NULL THEN
      INSERT INTO public.invoice_history (
        invoice_id, event_type, field_changed,
        old_value, new_value, order_id, changed_by,
        description, metadata
      ) VALUES (
        NEW.invoice_id, 'order_added', 'invoice_id',
        COALESCE(OLD.invoice_id::text, 'none'), NEW.invoice_id::text,
        NEW.order_id, auth.uid(),
        'Order ' || NEW.order_id || ' added to invoice',
        jsonb_build_object(
          'product_name', NEW.product_name,
          'quantity', NEW.quantity,
          'price', NEW.price,
          'total_amount', NEW.price * NEW.quantity,
          'confirmation_status', NEW.confirmation_status,
          'delivery_status', COALESCE(NEW.delivery_status, 'none')
        )
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- Create trigger AFTER the invoice assignment trigger
DROP TRIGGER IF EXISTS trg_log_invoice_order_assignment ON public.orders;
CREATE TRIGGER trg_log_invoice_order_assignment
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.log_invoice_order_assignment();

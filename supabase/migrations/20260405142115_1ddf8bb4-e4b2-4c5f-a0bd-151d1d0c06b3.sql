
-- Add INSERT trigger for auto-assigning invoice when orders are created with terminal statuses
CREATE OR REPLACE FUNCTION public.auto_assign_invoice_on_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_open_invoice_id uuid;
  v_new_invoice_id uuid;
BEGIN
  -- Only assign if order has a terminal status at creation
  IF NEW.confirmation_status IN ('confirmed', 'cancelled')
     OR NEW.delivery_status IN ('shipped', 'delivered') THEN
    
    IF NEW.invoice_id IS NULL THEN
      SELECT id INTO v_open_invoice_id
      FROM public.invoices
      WHERE seller_id = NEW.seller_id
        AND status = 'open'
      ORDER BY created_at DESC
      LIMIT 1;

      IF v_open_invoice_id IS NOT NULL THEN
        NEW.invoice_id := v_open_invoice_id;
      ELSE
        INSERT INTO public.invoices (seller_id, status)
        VALUES (NEW.seller_id, 'open')
        RETURNING id INTO v_new_invoice_id;
        NEW.invoice_id := v_new_invoice_id;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_auto_assign_invoice_on_insert
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_assign_invoice_on_insert();

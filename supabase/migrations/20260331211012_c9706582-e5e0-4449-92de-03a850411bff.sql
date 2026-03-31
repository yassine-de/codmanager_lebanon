
-- Create invoice_adjustments table
CREATE TABLE public.invoice_adjustments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id TEXT NOT NULL,
  seller_id UUID NOT NULL,
  invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  old_status TEXT NOT NULL,
  new_status TEXT NOT NULL,
  previous_amount NUMERIC NOT NULL DEFAULT 0,
  new_amount NUMERIC NOT NULL DEFAULT 0,
  difference NUMERIC NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT 'status_change',
  status TEXT NOT NULL DEFAULT 'pending',
  applied_invoice_id UUID REFERENCES public.invoices(id) ON DELETE SET NULL,
  reviewed_by UUID,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.invoice_adjustments ENABLE ROW LEVEL SECURITY;

-- Admin full access
CREATE POLICY "Admins full access invoice_adjustments"
ON public.invoice_adjustments FOR ALL
TO authenticated
USING (is_admin(auth.uid()))
WITH CHECK (is_admin(auth.uid()));

-- Sellers can view own adjustments
CREATE POLICY "Sellers view own adjustments"
ON public.invoice_adjustments FOR SELECT
TO authenticated
USING (auth.uid() = seller_id);

-- Create trigger function to auto-create adjustments
CREATE OR REPLACE FUNCTION public.create_invoice_adjustment_on_status_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_invoice_status TEXT;
BEGIN
  -- Only proceed if the order has an invoice
  IF OLD.invoice_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Check if the invoice is closed (ready or paid)
  SELECT status INTO v_invoice_status
  FROM public.invoices
  WHERE id = OLD.invoice_id;

  IF v_invoice_status NOT IN ('ready', 'paid') THEN
    RETURN NEW;
  END IF;

  -- Check if delivery_status changed (e.g. delivered → returned)
  IF OLD.delivery_status IS DISTINCT FROM NEW.delivery_status THEN
    INSERT INTO public.invoice_adjustments (
      order_id, seller_id, invoice_id,
      old_status, new_status,
      previous_amount, new_amount, difference,
      reason
    ) VALUES (
      NEW.order_id, NEW.seller_id, OLD.invoice_id,
      COALESCE(OLD.delivery_status, 'none'), COALESCE(NEW.delivery_status, 'none'),
      OLD.price * OLD.quantity,
      CASE WHEN NEW.delivery_status = 'delivered' THEN NEW.price * NEW.quantity ELSE 0 END,
      CASE WHEN NEW.delivery_status = 'delivered' THEN NEW.price * NEW.quantity ELSE 0 END - (OLD.price * OLD.quantity),
      'delivery_status_change'
    );
  END IF;

  -- Check if confirmation_status changed
  IF OLD.confirmation_status IS DISTINCT FROM NEW.confirmation_status THEN
    INSERT INTO public.invoice_adjustments (
      order_id, seller_id, invoice_id,
      old_status, new_status,
      previous_amount, new_amount, difference,
      reason
    ) VALUES (
      NEW.order_id, NEW.seller_id, OLD.invoice_id,
      OLD.confirmation_status, NEW.confirmation_status,
      OLD.price * OLD.quantity,
      CASE WHEN NEW.confirmation_status IN ('confirmed', 'new', 'postponed', 'no_answer') THEN NEW.price * NEW.quantity ELSE 0 END,
      CASE WHEN NEW.confirmation_status IN ('confirmed', 'new', 'postponed', 'no_answer') THEN NEW.price * NEW.quantity ELSE 0 END - (OLD.price * OLD.quantity),
      'confirmation_status_change'
    );
  END IF;

  RETURN NEW;
END;
$$;

-- Create the trigger
CREATE TRIGGER trg_invoice_adjustment_on_status_change
BEFORE UPDATE ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.create_invoice_adjustment_on_status_change();


-- 1. Add product_id to invoice_addons
ALTER TABLE public.invoice_addons ADD COLUMN IF NOT EXISTS product_id uuid REFERENCES public.products(id) ON DELETE SET NULL DEFAULT NULL;

-- 2. Add description and metadata to invoice_history
ALTER TABLE public.invoice_history ADD COLUMN IF NOT EXISTS description text DEFAULT '';
ALTER TABLE public.invoice_history ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

-- 3. RPC: add_invoice_addon (validates invoice status, logs history)
CREATE OR REPLACE FUNCTION public.add_invoice_addon(
  p_invoice_id uuid,
  p_type text,
  p_amount numeric,
  p_reason text,
  p_product_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_addon_id uuid;
  v_desc text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;

  IF v_invoice.status = 'paid' THEN
    RAISE EXCEPTION 'Cannot add addon to a paid invoice';
  END IF;

  IF p_type NOT IN ('in', 'out') THEN
    RAISE EXCEPTION 'Invalid addon type';
  END IF;

  IF p_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be positive';
  END IF;

  INSERT INTO public.invoice_addons (invoice_id, type, amount, reason, product_id)
  VALUES (p_invoice_id, p_type, p_amount, p_reason, p_product_id)
  RETURNING id INTO v_addon_id;

  v_desc := CASE WHEN p_type = 'out'
    THEN 'Admin added deduction: -' || p_amount || ' USD — ' || COALESCE(p_reason, '')
    ELSE 'Admin added bonus: +' || p_amount || ' USD — ' || COALESCE(p_reason, '')
  END;

  INSERT INTO public.invoice_history (invoice_id, event_type, field_changed, description, metadata, changed_by)
  VALUES (
    p_invoice_id,
    'addon_added',
    'addon',
    v_desc,
    jsonb_build_object('addon_id', v_addon_id, 'type', p_type, 'amount', p_amount, 'reason', p_reason, 'product_id', p_product_id),
    auth.uid()
  );

  RETURN jsonb_build_object('success', true, 'addon_id', v_addon_id);
END;
$$;

-- 4. RPC: remove_invoice_addon (validates invoice status, logs history)
CREATE OR REPLACE FUNCTION public.remove_invoice_addon(p_addon_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_addon public.invoice_addons%ROWTYPE;
  v_invoice_status text;
  v_desc text;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT * INTO v_addon FROM public.invoice_addons WHERE id = p_addon_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Addon not found'; END IF;

  SELECT status INTO v_invoice_status FROM public.invoices WHERE id = v_addon.invoice_id;

  IF v_invoice_status = 'paid' THEN
    RAISE EXCEPTION 'Cannot remove addon from a paid invoice';
  END IF;

  v_desc := 'Admin removed ' || CASE WHEN v_addon.type = 'out' THEN 'deduction' ELSE 'bonus' END
    || ': ' || v_addon.amount || ' USD — ' || COALESCE(v_addon.reason, '');

  INSERT INTO public.invoice_history (invoice_id, event_type, field_changed, description, metadata, changed_by)
  VALUES (
    v_addon.invoice_id,
    'addon_removed',
    'addon',
    v_desc,
    jsonb_build_object('addon_id', v_addon.id, 'type', v_addon.type, 'amount', v_addon.amount, 'reason', v_addon.reason),
    auth.uid()
  );

  DELETE FROM public.invoice_addons WHERE id = p_addon_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

-- Agents must choose a valid catalog variant before moving an order to confirmed.
-- Limit this to agent-originated transitions so existing WhatsApp/admin flows are unchanged.
CREATE OR REPLACE FUNCTION public.require_agent_variant_before_confirmation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.confirmation_status = 'confirmed'
     AND OLD.confirmation_status IS DISTINCT FROM 'confirmed'
     AND public.has_role(auth.uid(), 'agent'::public.app_role)
     AND EXISTS (
       SELECT 1
       FROM public.products p
       WHERE p.seller_id = NEW.seller_id
         AND p.name = NEW.product_name
         AND jsonb_typeof(p.variants) = 'array'
         AND jsonb_array_length(p.variants) > 0
         AND NOT EXISTS (
           SELECT 1
           FROM jsonb_array_elements(p.variants) AS variant
           WHERE (
             NULLIF(BTRIM(NEW.variant_name), '') IS NOT NULL
             AND LOWER(BTRIM(variant ->> 'name')) = LOWER(BTRIM(NEW.variant_name))
           ) OR (
             NULLIF(BTRIM(NEW.variant_sku), '') IS NOT NULL
             AND LOWER(BTRIM(variant ->> 'sku')) = LOWER(BTRIM(NEW.variant_sku))
           )
         )
     )
  THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Select a valid product variant before confirming this order.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS require_agent_variant_before_confirmation ON public.orders;
CREATE TRIGGER require_agent_variant_before_confirmation
BEFORE UPDATE OF confirmation_status ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.require_agent_variant_before_confirmation();

NOTIFY pgrst, 'reload schema';

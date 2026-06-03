CREATE OR REPLACE FUNCTION public.generate_product_sku()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_sku text;
BEGIN
  LOOP
    v_sku := 'PRD-' || LPAD(nextval('product_sku_seq')::text, 3, '0');

    IF NOT EXISTS (
      SELECT 1
      FROM public.products
      WHERE sku = v_sku
    ) THEN
      RETURN v_sku;
    END IF;
  END LOOP;
END;
$function$;

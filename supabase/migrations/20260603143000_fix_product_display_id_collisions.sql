CREATE OR REPLACE FUNCTION public.generate_product_display_id(p_seller_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_prefix text;
  v_counter integer;
  v_display_id text;
BEGIN
  SELECT prefix INTO v_prefix
  FROM seller_order_prefixes
  WHERE seller_id = p_seller_id;

  IF v_prefix IS NULL OR trim(v_prefix) = '' THEN
    v_prefix := 'PRD';
  END IF;

  LOOP
    INSERT INTO seller_product_counters (seller_id, current_counter)
    VALUES (p_seller_id, 1)
    ON CONFLICT (seller_id)
    DO UPDATE SET current_counter = seller_product_counters.current_counter + 1
    RETURNING current_counter INTO v_counter;

    v_display_id := v_prefix || '-P' || LPAD(v_counter::text, 3, '0');

    IF NOT EXISTS (
      SELECT 1
      FROM public.products
      WHERE display_id = v_display_id
    ) THEN
      RETURN v_display_id;
    END IF;
  END LOOP;
END;
$function$;

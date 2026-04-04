CREATE OR REPLACE FUNCTION public.get_invoice_summary(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_invoice RECORD;
  v_seller_rates RECORD;
  v_rate_settings RECORD;
  v_previous_balance numeric := 0;
  v_delivered_orders jsonb := '[]'::jsonb;
  v_addons jsonb := '[]'::jsonb;
  v_adjustments jsonb := '[]'::jsonb;
  v_delivered_revenue_usd numeric := 0;
  v_shipping_fees numeric := 0;
  v_call_center_fees numeric := 0;
  v_cod_fees numeric := 0;
  v_addon_net numeric := 0;
  v_adjustment_net numeric := 0;
  v_net_payable numeric := 0;
  v_shipped_count integer := 0;
  v_confirmed_count integer := 0;
  v_processed_count integer := 0;
BEGIN
  SELECT i.*
  INTO v_invoice
  FROM public.invoices i
  WHERE i.id = p_invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  v_previous_balance := COALESCE(v_invoice.previous_balance, 0);

  SELECT sr.rate_1kg, sr.rate_2kg, sr.rate_3kg, sr.rate_3kg_plus
  INTO v_seller_rates
  FROM public.seller_rates sr
  WHERE sr.user_id = v_invoice.seller_id
  LIMIT 1;

  SELECT rs.confirmed_order_rate, rs.dropped_order_rate, rs.cod_fee_per_delivery
  INTO v_rate_settings
  FROM public.rate_settings rs
  WHERE rs.seller_id = v_invoice.seller_id
  ORDER BY rs.updated_at DESC
  LIMIT 1;

  IF v_rate_settings IS NULL THEN
    SELECT rs.confirmed_order_rate, rs.dropped_order_rate, rs.cod_fee_per_delivery
    INTO v_rate_settings
    FROM public.rate_settings rs
    WHERE rs.seller_id IS NULL AND rs.is_global = true
    ORDER BY rs.updated_at DESC
    LIMIT 1;
  END IF;

  WITH invoice_orders AS (
    SELECT
      o.id,
      o.order_id,
      o.customer_name,
      o.customer_phone,
      o.product_name,
      o.quantity,
      o.price,
      o.total_amount,
      o.confirmation_status,
      o.delivery_status,
      o.created_at,
      p.weight_kg,
      EXISTS (
        SELECT 1
        FROM public.order_history oh
        WHERE oh.order_id = o.order_id
          AND oh.field_changed = 'delivery_status'
          AND oh.new_value = 'shipped'
      ) AS has_shipment_event
    FROM public.orders o
    LEFT JOIN public.products p
      ON p.seller_id = o.seller_id
     AND p.name = o.product_name
    WHERE o.invoice_id = p_invoice_id
  ), delivered AS (
    SELECT *
    FROM invoice_orders
    WHERE delivery_status = 'delivered'
  ), shipped AS (
    SELECT *
    FROM invoice_orders
    WHERE has_shipment_event = true
  ), addons_source AS (
    SELECT id, invoice_id, type, amount, reason, created_at
    FROM public.invoice_addons
    WHERE invoice_id = p_invoice_id
    ORDER BY created_at ASC
  ), adjustments_source AS (
    SELECT id, order_id, seller_id, invoice_id, applied_invoice_id, old_status, new_status, difference, reason, status, created_at
    FROM public.invoice_adjustments
    WHERE applied_invoice_id = p_invoice_id
      AND status = 'approved'
    ORDER BY created_at ASC
  ), counts AS (
    SELECT
      COUNT(*) FILTER (WHERE has_shipment_event = true)::integer AS shipped_count,
      COUNT(*) FILTER (WHERE confirmation_status = 'confirmed')::integer AS confirmed_count,
      COUNT(*) FILTER (WHERE confirmation_status IS NOT NULL AND confirmation_status <> 'new')::integer AS processed_count
    FROM invoice_orders
  ), money AS (
    SELECT
      COALESCE(SUM((d.price * d.quantity) / 290.0), 0)::numeric AS delivered_revenue_usd,
      COALESCE(SUM(
        CASE
          WHEN s.has_shipment_event IS NOT TRUE THEN 0
          WHEN COALESCE(s.weight_kg, 0) <= 0 OR v_seller_rates IS NULL THEN 0
          ELSE
            CASE
              WHEN CEIL(s.weight_kg * s.quantity) <= 1 THEN COALESCE(v_seller_rates.rate_1kg, 0)
              WHEN CEIL(s.weight_kg * s.quantity) <= 2 THEN COALESCE(v_seller_rates.rate_2kg, 0)
              WHEN CEIL(s.weight_kg * s.quantity) <= 3 THEN COALESCE(v_seller_rates.rate_3kg, 0)
              ELSE COALESCE(v_seller_rates.rate_3kg_plus, v_seller_rates.rate_3kg, 0)
            END
        END
      ), 0)::numeric AS shipping_fees
    FROM invoice_orders s
    LEFT JOIN delivered d ON d.id = s.id
  )
  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', d.id,
          'order_id', d.order_id,
          'customer_name', d.customer_name,
          'customer_phone', d.customer_phone,
          'product_name', d.product_name,
          'quantity', d.quantity,
          'price', d.price,
          'total_amount', d.total_amount,
          'created_at', d.created_at,
          'weight_kg', d.weight_kg
        ) ORDER BY d.created_at DESC
      ),
      '[]'::jsonb
    ),
    COALESCE((SELECT jsonb_agg(to_jsonb(a)) FROM addons_source a), '[]'::jsonb),
    COALESCE((SELECT jsonb_agg(to_jsonb(adj)) FROM adjustments_source adj), '[]'::jsonb),
    c.shipped_count,
    c.confirmed_count,
    c.processed_count,
    m.delivered_revenue_usd,
    m.shipping_fees,
    COALESCE((SELECT SUM(CASE WHEN a.type = 'out' THEN -a.amount ELSE a.amount END) FROM addons_source a), 0)::numeric,
    COALESCE((SELECT SUM(adj.difference / 290.0) FROM adjustments_source adj), 0)::numeric
  INTO
    v_delivered_orders,
    v_addons,
    v_adjustments,
    v_shipped_count,
    v_confirmed_count,
    v_processed_count,
    v_delivered_revenue_usd,
    v_shipping_fees,
    v_addon_net,
    v_adjustment_net
  FROM delivered d
  CROSS JOIN counts c
  CROSS JOIN money m;

  v_call_center_fees :=
    COALESCE(v_confirmed_count, 0) * COALESCE(v_rate_settings.confirmed_order_rate, 0)
    + GREATEST(COALESCE(v_processed_count, 0) - COALESCE(v_confirmed_count, 0), 0) * COALESCE(v_rate_settings.dropped_order_rate, 0);

  v_cod_fees := v_delivered_revenue_usd * (COALESCE(v_rate_settings.cod_fee_per_delivery, 0) / 100.0);

  v_net_payable :=
    v_delivered_revenue_usd
    - v_shipping_fees
    - v_call_center_fees
    - v_cod_fees
    + v_addon_net
    + v_adjustment_net
    + v_previous_balance;

  RETURN jsonb_build_object(
    'invoice', jsonb_build_object(
      'id', v_invoice.id,
      'invoice_number', v_invoice.invoice_number,
      'seller_id', v_invoice.seller_id,
      'status', v_invoice.status,
      'created_at', v_invoice.created_at,
      'finalized_at', v_invoice.finalized_at,
      'paid_at', v_invoice.paid_at,
      'paid_by', v_invoice.paid_by,
      'payment_proof_url', v_invoice.payment_proof_url,
      'previous_balance', v_previous_balance
    ),
    'rates', jsonb_build_object(
      'shipping', jsonb_build_object(
        'rate_1kg', COALESCE(v_seller_rates.rate_1kg, 0),
        'rate_2kg', COALESCE(v_seller_rates.rate_2kg, 0),
        'rate_3kg', COALESCE(v_seller_rates.rate_3kg, 0),
        'rate_3kg_plus', COALESCE(v_seller_rates.rate_3kg_plus, COALESCE(v_seller_rates.rate_3kg, 0))
      ),
      'call_center', jsonb_build_object(
        'confirmed_rate', COALESCE(v_rate_settings.confirmed_order_rate, 0),
        'dropped_rate', COALESCE(v_rate_settings.dropped_order_rate, 0)
      ),
      'cod_fee_percentage', COALESCE(v_rate_settings.cod_fee_per_delivery, 0)
    ),
    'counts', jsonb_build_object(
      'delivered_count', COALESCE(jsonb_array_length(v_delivered_orders), 0),
      'shipped_count', COALESCE(v_shipped_count, 0),
      'confirmed_count', COALESCE(v_confirmed_count, 0),
      'processed_count', COALESCE(v_processed_count, 0)
    ),
    'delivered_orders', v_delivered_orders,
    'addons', v_addons,
    'adjustments', v_adjustments,
    'totals', jsonb_build_object(
      'delivered_revenue_usd', COALESCE(v_delivered_revenue_usd, 0),
      'shipping_fees', COALESCE(v_shipping_fees, 0),
      'call_center_fees', COALESCE(v_call_center_fees, 0),
      'cod_fees', COALESCE(v_cod_fees, 0),
      'addon_net', COALESCE(v_addon_net, 0),
      'adjustment_net', COALESCE(v_adjustment_net, 0),
      'previous_balance', COALESCE(v_previous_balance, 0),
      'net_payable', COALESCE(v_net_payable, 0)
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.auto_assign_invoice_on_delivery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_open_invoice_id uuid;
  v_new_invoice_id uuid;
  v_current_invoice_status text;
  v_has_terminal_event boolean := false;
BEGIN
  v_has_terminal_event := (
    (NEW.confirmation_status = 'confirmed' AND OLD.confirmation_status IS DISTINCT FROM 'confirmed')
    OR (NEW.confirmation_status = 'cancelled' AND OLD.confirmation_status IS DISTINCT FROM 'cancelled')
    OR (
      NEW.delivery_status = 'shipped'
      AND OLD.delivery_status IS DISTINCT FROM 'shipped'
    )
    OR (
      NEW.delivery_status = 'delivered'
      AND OLD.delivery_status IS DISTINCT FROM 'delivered'
    )
  );

  IF v_has_terminal_event THEN
    IF NEW.invoice_id IS NOT NULL THEN
      SELECT status INTO v_current_invoice_status
      FROM public.invoices
      WHERE id = NEW.invoice_id;

      IF v_current_invoice_status IN ('ready', 'paid') THEN
        NEW.invoice_id := NULL;
      END IF;
    END IF;

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

  IF OLD.delivery_status = 'delivered'
     AND NEW.delivery_status IS DISTINCT FROM OLD.delivery_status
     AND NEW.invoice_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.invoices
      WHERE id = NEW.invoice_id
        AND status = 'open'
    ) THEN
      NEW.invoice_id := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;
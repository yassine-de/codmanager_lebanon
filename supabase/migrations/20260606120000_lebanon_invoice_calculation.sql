-- Lebanon invoice rules:
-- - Order amounts are already USD.
-- - Charge 9.50 USD delivery fee for each delivered order.
-- - Charge 5% COD fee on delivered order amount.
-- - No Pakistan/PKR conversion and no weight-based delivery rates.

CREATE OR REPLACE FUNCTION public.get_invoice_summary(p_invoice_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_delivery_fee numeric := 9.50;
  v_cod_fee_percentage numeric := 5.00;
  v_previous_balance numeric := 0;
  v_total_orders_count integer := 0;
  v_delivered_count integer := 0;
  v_shipped_count integer := 0;
  v_confirmed_count integer := 0;
  v_dropped_count integer := 0;
  v_cross_delivered_count integer := 0;
  v_delivered_revenue_usd numeric := 0;
  v_shipping_fees numeric := 0;
  v_call_center_fees numeric := 0;
  v_cod_fees numeric := 0;
  v_addon_net numeric := 0;
  v_adjustment_net numeric := 0;
  v_net_payable numeric := 0;
  v_delivered_orders jsonb := '[]'::jsonb;
  v_all_orders jsonb := '[]'::jsonb;
  v_shipping_breakdown jsonb := '[]'::jsonb;
  v_addons jsonb := '[]'::jsonb;
  v_adjustments jsonb := '[]'::jsonb;
  v_period_start timestamptz;
  v_period_end timestamptz;
BEGIN
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  v_period_end := COALESCE(v_invoice.finalized_at, now());

  SELECT MAX(finalized_at)
    INTO v_period_start
    FROM public.invoices
    WHERE seller_id = v_invoice.seller_id
      AND id != p_invoice_id
      AND finalized_at IS NOT NULL
      AND finalized_at < v_period_end;

  IF v_period_start IS NULL THEN
    v_period_start := '-infinity'::timestamptz;
  END IF;

  v_previous_balance := COALESCE(v_invoice.previous_balance, 0);

  SELECT COUNT(DISTINCT o.id)
    INTO v_total_orders_count
    FROM public.orders o
    WHERE o.invoice_id = p_invoice_id;

  SELECT COUNT(DISTINCT o.id)
    INTO v_confirmed_count
    FROM public.orders o
    WHERE o.invoice_id = p_invoice_id
      AND o.confirmation_status = 'confirmed';

  SELECT COUNT(DISTINCT o.id)
    INTO v_dropped_count
    FROM public.orders o
    WHERE o.invoice_id = p_invoice_id
      AND o.confirmation_status IN ('cancelled', 'wrong_number');

  SELECT COUNT(DISTINCT o.id)
    INTO v_shipped_count
    FROM public.orders o
    WHERE o.invoice_id = p_invoice_id
      AND o.delivery_status IN (
        'booked', 'shipped', 'in_transit', 'with_courier',
        'out_for_delivery', 'failed_attempt', 'ready_for_return',
        'return', 'returned', 'delivered'
      );

  WITH delivered AS (
    SELECT
      o.id,
      o.order_id,
      o.customer_name,
      o.customer_phone,
      o.product_name,
      o.quantity,
      o.price,
      COALESCE(o.total_amount, o.price * o.quantity) AS total_amount,
      o.created_at,
      COALESCE(
        p.weight_kg,
        CASE
          WHEN p.weight = 'up_to_1kg' THEN 0.5
          WHEN p.weight = 'up_to_2kg' THEN 1.5
          WHEN p.weight = 'up_to_3kg' THEN 2.5
          WHEN p.weight = 'above_3kg' THEN 3.5
          ELSE NULL
        END
      ) AS weight_kg,
      false AS is_cross_invoice,
      NULL::text AS original_invoice_number
    FROM public.orders o
    LEFT JOIN public.products p ON p.seller_id = o.seller_id AND p.name = o.product_name
    WHERE o.invoice_id = p_invoice_id
      AND o.delivery_status = 'delivered'
      AND EXISTS (
        SELECT 1
        FROM public.order_history oh
        WHERE oh.order_id = o.order_id
          AND oh.field_changed = 'delivery_status'
          AND oh.new_value = 'delivered'
          AND oh.created_at > v_period_start
          AND oh.created_at <= v_period_end
      )
  ), cross_delivered AS (
    SELECT
      o.id,
      o.order_id,
      o.customer_name,
      o.customer_phone,
      o.product_name,
      o.quantity,
      o.price,
      COALESCE(o.total_amount, o.price * o.quantity) AS total_amount,
      o.created_at,
      COALESCE(
        p.weight_kg,
        CASE
          WHEN p.weight = 'up_to_1kg' THEN 0.5
          WHEN p.weight = 'up_to_2kg' THEN 1.5
          WHEN p.weight = 'up_to_3kg' THEN 2.5
          WHEN p.weight = 'above_3kg' THEN 3.5
          ELSE NULL
        END
      ) AS weight_kg,
      true AS is_cross_invoice,
      inv_orig.invoice_number AS original_invoice_number
    FROM public.orders o
    JOIN public.invoices inv_orig ON inv_orig.id = o.invoice_id
    LEFT JOIN public.products p ON p.seller_id = o.seller_id AND p.name = o.product_name
    WHERE o.seller_id = v_invoice.seller_id
      AND o.invoice_id != p_invoice_id
      AND inv_orig.status IN ('ready', 'paid')
      AND inv_orig.finalized_at IS NOT NULL
      AND o.delivery_status = 'delivered'
      AND EXISTS (
        SELECT 1
        FROM public.order_history oh
        WHERE oh.order_id = o.order_id
          AND oh.field_changed = 'delivery_status'
          AND oh.new_value = 'delivered'
          AND oh.created_at > inv_orig.finalized_at
          AND oh.created_at > v_period_start
          AND oh.created_at <= v_period_end
      )
  ), all_delivered AS (
    SELECT * FROM delivered
    UNION ALL
    SELECT * FROM cross_delivered
  )
  SELECT
    COUNT(*)::integer,
    COUNT(*) FILTER (WHERE is_cross_invoice)::integer,
    COALESCE(SUM(total_amount), 0),
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', id,
      'order_id', order_id,
      'customer_name', customer_name,
      'customer_phone', customer_phone,
      'product_name', product_name,
      'quantity', quantity,
      'price', price,
      'total_amount', total_amount,
      'created_at', created_at,
      'weight_kg', weight_kg,
      'total_weight_kg', COALESCE(weight_kg, 0) * quantity,
      'amount_usd', total_amount,
      'is_cross_invoice', is_cross_invoice,
      'original_invoice_number', original_invoice_number
    ) ORDER BY created_at), '[]'::jsonb)
  INTO v_delivered_count, v_cross_delivered_count, v_delivered_revenue_usd, v_delivered_orders
  FROM all_delivered;

  WITH invoice_orders AS (
    SELECT
      o.id,
      o.order_id,
      o.customer_name,
      o.customer_phone,
      o.product_name,
      o.quantity,
      o.price,
      COALESCE(o.total_amount, o.price * o.quantity) AS total_amount,
      o.created_at,
      o.confirmation_status,
      COALESCE(o.delivery_status, 'none') AS delivery_status,
      COALESCE(
        p.weight_kg,
        CASE
          WHEN p.weight = 'up_to_1kg' THEN 0.5
          WHEN p.weight = 'up_to_2kg' THEN 1.5
          WHEN p.weight = 'up_to_3kg' THEN 2.5
          WHEN p.weight = 'above_3kg' THEN 3.5
          ELSE NULL
        END
      ) AS weight_kg,
      EXISTS (
        SELECT 1 FROM public.invoice_adjustments ia
        WHERE ia.order_id = o.order_id AND ia.applied_invoice_id = p_invoice_id
      ) AS has_adjustment,
      (
        SELECT ia.applied_invoice_id FROM public.invoice_adjustments ia
        WHERE ia.order_id = o.order_id AND ia.applied_invoice_id IS NOT NULL
        ORDER BY ia.created_at DESC LIMIT 1
      ) AS adjustment_invoice_id,
      (
        SELECT inv.invoice_number
        FROM public.invoice_adjustments ia
        JOIN public.invoices inv ON inv.id = ia.applied_invoice_id
        WHERE ia.order_id = o.order_id AND ia.applied_invoice_id IS NOT NULL
        ORDER BY ia.created_at DESC LIMIT 1
      ) AS adjustment_invoice_number,
      o.delivery_status = 'delivered' AS was_delivered
    FROM public.orders o
    LEFT JOIN public.products p ON p.seller_id = o.seller_id AND p.name = o.product_name
    WHERE o.invoice_id = p_invoice_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id,
    'order_id', order_id,
    'customer_name', customer_name,
    'customer_phone', customer_phone,
    'product_name', product_name,
    'quantity', quantity,
    'price', price,
    'total_amount', total_amount,
    'created_at', created_at,
    'weight_kg', weight_kg,
    'total_weight_kg', COALESCE(weight_kg, 0) * quantity,
    'amount_usd', total_amount,
    'confirmation_status', confirmation_status,
    'delivery_status', delivery_status,
    'has_adjustment', has_adjustment,
    'adjustment_invoice_id', adjustment_invoice_id,
    'adjustment_invoice_number', adjustment_invoice_number,
    'was_delivered', was_delivered,
    'is_cross_invoice', false,
    'original_invoice_number', NULL
  ) ORDER BY created_at), '[]'::jsonb)
  INTO v_all_orders
  FROM invoice_orders;

  v_shipping_fees := ROUND(v_delivered_count * v_delivery_fee, 2);
  v_cod_fees := ROUND(v_delivered_revenue_usd * (v_cod_fee_percentage / 100), 2);
  v_call_center_fees := 0;

  IF v_delivered_count > 0 THEN
    v_shipping_breakdown := jsonb_build_array(jsonb_build_object(
      'bracket', 'Delivered orders',
      'count', v_delivered_count,
      'fee', v_shipping_fees
    ));
  END IF;

  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', id,
      'invoice_id', invoice_id,
      'type', type,
      'amount', amount,
      'reason', reason,
      'created_at', created_at
    ) ORDER BY created_at), '[]'::jsonb),
    COALESCE(SUM(CASE WHEN type = 'in' THEN amount ELSE -amount END), 0)
  INTO v_addons, v_addon_net
  FROM public.invoice_addons
  WHERE invoice_id = p_invoice_id;

  SELECT
    COALESCE(jsonb_agg(jsonb_build_object(
      'id', id,
      'order_id', order_id,
      'seller_id', seller_id,
      'invoice_id', invoice_id,
      'applied_invoice_id', applied_invoice_id,
      'old_status', old_status,
      'new_status', new_status,
      'difference', difference,
      'difference_usd', difference,
      'shipping_difference', shipping_difference,
      'shipping_difference_usd', shipping_difference,
      'reason', reason,
      'status', status,
      'created_at', created_at
    ) ORDER BY created_at), '[]'::jsonb),
    COALESCE(SUM(CASE WHEN status = 'approved' THEN difference + shipping_difference ELSE 0 END), 0)
  INTO v_adjustments, v_adjustment_net
  FROM public.invoice_adjustments
  WHERE applied_invoice_id = p_invoice_id;

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
        'rate_1kg', v_delivery_fee,
        'rate_2kg', v_delivery_fee,
        'rate_3kg', v_delivery_fee,
        'rate_3kg_plus', v_delivery_fee
      ),
      'call_center', jsonb_build_object(
        'confirmed_rate', 0,
        'dropped_rate', 0
      ),
      'cod_fee_percentage', v_cod_fee_percentage
    ),
    'counts', jsonb_build_object(
      'total_orders_count', v_total_orders_count,
      'delivered_count', v_delivered_count,
      'shipped_count', v_shipped_count,
      'confirmed_count', v_confirmed_count,
      'dropped_count', v_dropped_count,
      'cross_shipped_count', 0,
      'cross_delivered_count', v_cross_delivered_count,
      'cross_confirmed_count', 0
    ),
    'call_center_breakdown', jsonb_build_object(
      'confirmed_count', v_confirmed_count,
      'confirmed_rate', 0,
      'confirmed_fees', 0,
      'dropped_count', v_dropped_count,
      'dropped_rate', 0,
      'dropped_fees', 0
    ),
    'delivered_orders', v_delivered_orders,
    'all_orders', v_all_orders,
    'shipping_breakdown', v_shipping_breakdown,
    'addons', v_addons,
    'adjustments', v_adjustments,
    'totals', jsonb_build_object(
      'delivered_revenue_usd', ROUND(v_delivered_revenue_usd, 2),
      'shipping_fees', ROUND(v_shipping_fees, 2),
      'call_center_fees', ROUND(v_call_center_fees, 2),
      'cod_fees', ROUND(v_cod_fees, 2),
      'addon_net', ROUND(v_addon_net, 2),
      'adjustment_net', ROUND(v_adjustment_net, 2),
      'previous_balance', ROUND(v_previous_balance, 2),
      'net_payable', ROUND(v_net_payable, 2)
    )
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_invoice_adjustment_on_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_invoice_status text;
  v_diff numeric := 0;
  v_shipping_diff numeric := 0;
  v_delivery_fee numeric := 9.50;
  v_reason text;
BEGIN
  IF OLD.invoice_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT status INTO v_invoice_status
  FROM public.invoices
  WHERE id = OLD.invoice_id;

  IF v_invoice_status NOT IN ('ready', 'paid') THEN
    RETURN NEW;
  END IF;

  IF OLD.delivery_status IS DISTINCT FROM NEW.delivery_status THEN
    IF OLD.delivery_status = 'delivered' AND COALESCE(NEW.delivery_status, 'none') != 'delivered' THEN
      v_diff := -COALESCE(OLD.total_amount, OLD.price * OLD.quantity);
      v_shipping_diff := v_delivery_fee;
      v_reason := 'delivery_status_change';
    ELSIF COALESCE(OLD.delivery_status, 'none') != 'delivered' AND NEW.delivery_status = 'delivered' THEN
      v_diff := COALESCE(NEW.total_amount, NEW.price * NEW.quantity);
      v_shipping_diff := -v_delivery_fee;
      v_reason := 'delivery_status_change';
    END IF;

    IF v_diff != 0 OR v_shipping_diff != 0 THEN
      INSERT INTO public.invoice_adjustments (
        order_id, seller_id, invoice_id,
        old_status, new_status,
        previous_amount, new_amount, difference,
        previous_shipping_fee, new_shipping_fee, shipping_difference,
        reason, status
      ) VALUES (
        NEW.order_id, NEW.seller_id, OLD.invoice_id,
        COALESCE(OLD.delivery_status, 'none'), COALESCE(NEW.delivery_status, 'none'),
        COALESCE(OLD.total_amount, OLD.price * OLD.quantity),
        COALESCE(NEW.total_amount, NEW.price * NEW.quantity),
        v_diff,
        CASE WHEN OLD.delivery_status = 'delivered' THEN v_delivery_fee ELSE 0 END,
        CASE WHEN NEW.delivery_status = 'delivered' THEN v_delivery_fee ELSE 0 END,
        v_shipping_diff,
        v_reason, 'pending'
      );
    END IF;
  END IF;

  IF (OLD.price IS DISTINCT FROM NEW.price OR OLD.quantity IS DISTINCT FROM NEW.quantity OR OLD.total_amount IS DISTINCT FROM NEW.total_amount)
     AND OLD.delivery_status IS NOT DISTINCT FROM NEW.delivery_status
     AND NEW.delivery_status = 'delivered' THEN
    v_diff :=
      COALESCE(NEW.total_amount, NEW.price * NEW.quantity)
      - COALESCE(OLD.total_amount, OLD.price * OLD.quantity);

    IF v_diff != 0 THEN
      INSERT INTO public.invoice_adjustments (
        order_id, seller_id, invoice_id,
        old_status, new_status,
        previous_amount, new_amount, difference,
        previous_shipping_fee, new_shipping_fee, shipping_difference,
        reason, status
      ) VALUES (
        NEW.order_id, NEW.seller_id, OLD.invoice_id,
        'delivered', 'delivered',
        COALESCE(OLD.total_amount, OLD.price * OLD.quantity),
        COALESCE(NEW.total_amount, NEW.price * NEW.quantity),
        v_diff,
        v_delivery_fee, v_delivery_fee, 0,
        'amount_change', 'pending'
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

NOTIFY pgrst, 'reload schema';

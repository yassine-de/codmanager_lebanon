
-- Step 1: Add shipping columns to invoice_adjustments
ALTER TABLE public.invoice_adjustments
  ADD COLUMN IF NOT EXISTS previous_shipping_fee numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS new_shipping_fee numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_difference numeric NOT NULL DEFAULT 0;

-- Step 2: Replace the trigger function with shipping-aware logic
CREATE OR REPLACE FUNCTION public.create_invoice_adjustment_on_status_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_invoice_status text;
  v_diff numeric := 0;
  v_old_status text;
  v_new_status text;
  v_reason text;
  v_adj_id uuid;
  v_prev_shipping numeric := 0;
  v_new_shipping numeric := 0;
  v_shipping_diff numeric := 0;
  v_weight_kg numeric;
  v_old_total_weight numeric;
  v_new_total_weight numeric;
  v_seller_rates public.seller_rates%ROWTYPE;
  v_has_shipment boolean;
  v_quantity_changed boolean;
BEGIN
  -- Only proceed if the order has an invoice
  IF OLD.invoice_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get invoice status
  SELECT status INTO v_invoice_status
  FROM public.invoices
  WHERE id = OLD.invoice_id;

  -- If invoice is OPEN, changes are live — no adjustment needed
  IF v_invoice_status NOT IN ('ready', 'paid') THEN
    RETURN NEW;
  END IF;

  -- Check if quantity changed (the ONLY reason to recalculate shipping on closed invoice)
  v_quantity_changed := (OLD.quantity IS DISTINCT FROM NEW.quantity);

  -- Calculate shipping difference ONLY if quantity changed
  IF v_quantity_changed THEN
    -- Check if order has a shipment event (shipping is event-based)
    SELECT EXISTS (
      SELECT 1 FROM public.order_history oh
      WHERE oh.order_id = OLD.order_id
        AND oh.field_changed = 'delivery_status'
        AND oh.new_value = 'shipped'
    ) INTO v_has_shipment;

    IF v_has_shipment THEN
      -- Get product weight
      SELECT COALESCE(p.weight_kg,
        CASE
          WHEN p.weight = 'up_to_1kg' THEN 0.5
          WHEN p.weight = 'up_to_2kg' THEN 1.5
          WHEN p.weight = 'up_to_3kg' THEN 2.5
          WHEN p.weight = 'above_3kg' THEN 3.5
          ELSE NULL
        END
      ) INTO v_weight_kg
      FROM public.products p
      WHERE p.seller_id = OLD.seller_id AND p.name = OLD.product_name
      LIMIT 1;

      IF v_weight_kg IS NOT NULL AND v_weight_kg > 0 THEN
        -- Get seller shipping rates
        SELECT * INTO v_seller_rates
        FROM public.seller_rates
        WHERE user_id = OLD.seller_id
        LIMIT 1;

        IF FOUND THEN
          -- Calculate old shipping fee (old quantity)
          v_old_total_weight := CEIL(v_weight_kg * OLD.quantity);
          v_prev_shipping := CASE
            WHEN v_old_total_weight <= 1 THEN COALESCE(v_seller_rates.rate_1kg, 0)
            WHEN v_old_total_weight <= 2 THEN COALESCE(v_seller_rates.rate_2kg, 0)
            WHEN v_old_total_weight <= 3 THEN COALESCE(v_seller_rates.rate_3kg, 0)
            ELSE COALESCE(v_seller_rates.rate_3kg_plus, v_seller_rates.rate_3kg, 0)
          END;

          -- Calculate new shipping fee (new quantity)
          v_new_total_weight := CEIL(v_weight_kg * NEW.quantity);
          v_new_shipping := CASE
            WHEN v_new_total_weight <= 1 THEN COALESCE(v_seller_rates.rate_1kg, 0)
            WHEN v_new_total_weight <= 2 THEN COALESCE(v_seller_rates.rate_2kg, 0)
            WHEN v_new_total_weight <= 3 THEN COALESCE(v_seller_rates.rate_3kg, 0)
            ELSE COALESCE(v_seller_rates.rate_3kg_plus, v_seller_rates.rate_3kg, 0)
          END;

          v_shipping_diff := v_new_shipping - v_prev_shipping;
        END IF;
      END IF;
    END IF;
  END IF;

  -- CASE: delivery_status changed (e.g., delivered → returned)
  IF OLD.delivery_status IS DISTINCT FROM NEW.delivery_status THEN
    v_old_status := COALESCE(OLD.delivery_status, 'none');
    v_new_status := COALESCE(NEW.delivery_status, 'none');

    -- Calculate exact financial impact (revenue only, NOT shipping)
    IF OLD.delivery_status = 'delivered' AND NEW.delivery_status != 'delivered' THEN
      v_diff := -(OLD.price * OLD.quantity);
      v_reason := 'delivery_status_change';
    ELSIF OLD.delivery_status != 'delivered' AND NEW.delivery_status = 'delivered' THEN
      v_diff := NEW.price * NEW.quantity;
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
        v_old_status, v_new_status,
        CASE WHEN OLD.delivery_status = 'delivered' THEN OLD.price * OLD.quantity ELSE 0 END,
        CASE WHEN NEW.delivery_status = 'delivered' THEN NEW.price * NEW.quantity ELSE 0 END,
        v_diff,
        v_prev_shipping, v_new_shipping, v_shipping_diff,
        v_reason, 'pending'
      ) RETURNING id INTO v_adj_id;

      INSERT INTO public.invoice_history (
        invoice_id, event_type, field_changed,
        old_value, new_value, order_id, changed_by
      ) VALUES (
        OLD.invoice_id, 'adjustment_created', 'delivery_status',
        v_old_status, v_new_status,
        NEW.order_id, auth.uid()
      );
    END IF;
  END IF;

  -- CASE: confirmation_status changed (e.g., confirmed → cancelled)
  IF OLD.confirmation_status IS DISTINCT FROM NEW.confirmation_status THEN
    v_old_status := OLD.confirmation_status;
    v_new_status := NEW.confirmation_status;
    v_reason := 'confirmation_status_change';

    INSERT INTO public.invoice_adjustments (
      order_id, seller_id, invoice_id,
      old_status, new_status,
      previous_amount, new_amount, difference,
      previous_shipping_fee, new_shipping_fee, shipping_difference,
      reason, status
    ) VALUES (
      NEW.order_id, NEW.seller_id, OLD.invoice_id,
      v_old_status, v_new_status,
      0, 0, 0,
      0, 0, 0,
      v_reason, 'pending'
    ) RETURNING id INTO v_adj_id;

    INSERT INTO public.invoice_history (
      invoice_id, event_type, field_changed,
      old_value, new_value, order_id, changed_by
    ) VALUES (
      OLD.invoice_id, 'adjustment_created', 'confirmation_status',
      v_old_status, v_new_status,
      NEW.order_id, auth.uid()
    );
  END IF;

  -- CASE: Only quantity changed (no status change) but order is on closed invoice
  IF v_quantity_changed
     AND OLD.delivery_status IS NOT DISTINCT FROM NEW.delivery_status
     AND OLD.confirmation_status IS NOT DISTINCT FROM NEW.confirmation_status
  THEN
    v_diff := 0;
    -- If delivered, revenue also changes with quantity
    IF NEW.delivery_status = 'delivered' THEN
      v_diff := (NEW.price * NEW.quantity) - (OLD.price * OLD.quantity);
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
        COALESCE(NEW.delivery_status, NEW.confirmation_status, 'unchanged'),
        COALESCE(NEW.delivery_status, NEW.confirmation_status, 'unchanged'),
        OLD.price * OLD.quantity,
        NEW.price * NEW.quantity,
        v_diff,
        v_prev_shipping, v_new_shipping, v_shipping_diff,
        'quantity_change', 'pending'
      ) RETURNING id INTO v_adj_id;

      INSERT INTO public.invoice_history (
        invoice_id, event_type, field_changed,
        old_value, new_value, order_id, changed_by
      ) VALUES (
        OLD.invoice_id, 'adjustment_created', 'quantity',
        OLD.quantity::text, NEW.quantity::text,
        NEW.order_id, auth.uid()
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- Step 3: Update get_invoice_summary to include shipping_difference in adjustment_net
CREATE OR REPLACE FUNCTION public.get_invoice_summary(p_invoice_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_invoice public.invoices%ROWTYPE;
  v_seller_rates public.seller_rates%ROWTYPE;
  v_confirmed_rate numeric := 0;
  v_dropped_rate numeric := 0;
  v_cod_fee_percentage numeric := 0;
  v_previous_balance numeric := 0;
  v_total_orders_count integer := 0;
  v_delivered_count integer := 0;
  v_shipped_count integer := 0;
  v_confirmed_count integer := 0;
  v_dropped_count integer := 0;
  v_all_period_count integer := 0;
  v_period_confirmed_count integer := 0;
  v_delivered_revenue_usd numeric := 0;
  v_shipping_fees numeric := 0;
  v_call_center_fees numeric := 0;
  v_cod_fees numeric := 0;
  v_addon_net numeric := 0;
  v_adjustment_net numeric := 0;
  v_net_payable numeric := 0;
  v_delivered_orders jsonb := '[]'::jsonb;
  v_shipping_breakdown jsonb := '[]'::jsonb;
  v_addons jsonb := '[]'::jsonb;
  v_adjustments jsonb := '[]'::jsonb;
  v_period_start timestamptz;
  v_period_end timestamptz;
BEGIN
  SELECT * INTO v_invoice FROM public.invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Invoice not found'; END IF;
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF auth.uid() <> v_invoice.seller_id AND NOT public.is_admin(auth.uid()) THEN RAISE EXCEPTION 'Forbidden'; END IF;

  v_previous_balance := COALESCE(v_invoice.previous_balance, 0);
  v_period_start := v_invoice.created_at;
  v_period_end := COALESCE(v_invoice.finalized_at, now());

  SELECT * INTO v_seller_rates FROM public.seller_rates WHERE user_id = v_invoice.seller_id LIMIT 1;

  SELECT COALESCE(rs.confirmed_order_rate, 0), COALESCE(rs.dropped_order_rate, 0), COALESCE(rs.cod_fee_per_delivery, 0)
  INTO v_confirmed_rate, v_dropped_rate, v_cod_fee_percentage
  FROM public.rate_settings rs WHERE rs.seller_id = v_invoice.seller_id ORDER BY rs.updated_at DESC LIMIT 1;

  IF NOT FOUND THEN
    SELECT COALESCE(rs.confirmed_order_rate, 0), COALESCE(rs.dropped_order_rate, 0), COALESCE(rs.cod_fee_per_delivery, 0)
    INTO v_confirmed_rate, v_dropped_rate, v_cod_fee_percentage
    FROM public.rate_settings rs WHERE rs.seller_id IS NULL AND rs.is_global = true ORDER BY rs.updated_at DESC LIMIT 1;
  END IF;

  SELECT
    COUNT(*)::integer,
    COUNT(*) FILTER (WHERE confirmation_status = 'confirmed')::integer
  INTO v_all_period_count, v_period_confirmed_count
  FROM public.orders
  WHERE seller_id = v_invoice.seller_id
    AND created_at >= v_period_start
    AND created_at <= v_period_end;

  v_dropped_count := v_all_period_count;

  WITH invoice_orders AS (
    SELECT o.id, o.order_id, o.customer_name, o.customer_phone, o.product_name, o.quantity, o.price, o.total_amount, o.confirmation_status, o.delivery_status, o.created_at,
      COALESCE(p.weight_kg,
        CASE
          WHEN p.weight = 'up_to_1kg' THEN 0.5
          WHEN p.weight = 'up_to_2kg' THEN 1.5
          WHEN p.weight = 'up_to_3kg' THEN 2.5
          WHEN p.weight = 'above_3kg' THEN 3.5
          ELSE NULL
        END
      ) AS weight_kg,
      EXISTS (SELECT 1 FROM public.order_history oh WHERE oh.order_id = o.order_id AND oh.field_changed = 'delivery_status' AND oh.new_value = 'shipped') AS has_shipment_event
    FROM public.orders o
    LEFT JOIN public.products p ON p.seller_id = o.seller_id AND p.name = o.product_name
    WHERE o.invoice_id = p_invoice_id
  )
  SELECT
    COUNT(*)::integer,
    COUNT(*) FILTER (WHERE delivery_status = 'delivered')::integer,
    COUNT(*) FILTER (WHERE has_shipment_event = true)::integer,
    COUNT(*) FILTER (WHERE confirmation_status = 'confirmed')::integer,
    COUNT(*) FILTER (WHERE confirmation_status IN ('cancelled', 'wrong_number', 'unreachable'))::integer,
    COALESCE(SUM((price * quantity) / 290.0) FILTER (WHERE delivery_status = 'delivered'), 0)::numeric
  INTO v_total_orders_count, v_delivered_count, v_shipped_count, v_confirmed_count, v_dropped_count, v_delivered_revenue_usd
  FROM invoice_orders;

  WITH invoice_orders AS (
    SELECT o.id, o.order_id, o.customer_name, o.customer_phone, o.product_name, o.quantity, o.price, o.total_amount, o.created_at,
      COALESCE(p.weight_kg,
        CASE
          WHEN p.weight = 'up_to_1kg' THEN 0.5
          WHEN p.weight = 'up_to_2kg' THEN 1.5
          WHEN p.weight = 'up_to_3kg' THEN 2.5
          WHEN p.weight = 'above_3kg' THEN 3.5
          ELSE NULL
        END
      ) AS weight_kg
    FROM public.orders o
    LEFT JOIN public.products p ON p.seller_id = o.seller_id AND p.name = o.product_name
    WHERE o.invoice_id = p_invoice_id AND o.delivery_status = 'delivered'
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'order_id', order_id, 'customer_name', customer_name, 'customer_phone', customer_phone,
    'product_name', product_name, 'quantity', quantity, 'price', price, 'total_amount', total_amount,
    'created_at', created_at, 'weight_kg', weight_kg,
    'total_weight_kg', CASE WHEN COALESCE(weight_kg, 0) > 0 THEN weight_kg * quantity ELSE NULL END,
    'amount_usd', ((price * quantity) / 290.0)
  ) ORDER BY created_at DESC), '[]'::jsonb)
  INTO v_delivered_orders FROM invoice_orders;

  WITH invoice_orders AS (
    SELECT o.quantity,
      COALESCE(p.weight_kg,
        CASE
          WHEN p.weight = 'up_to_1kg' THEN 0.5
          WHEN p.weight = 'up_to_2kg' THEN 1.5
          WHEN p.weight = 'up_to_3kg' THEN 2.5
          WHEN p.weight = 'above_3kg' THEN 3.5
          ELSE NULL
        END
      ) AS weight_kg,
      EXISTS (SELECT 1 FROM public.order_history oh WHERE oh.order_id = o.order_id AND oh.field_changed = 'delivery_status' AND oh.new_value = 'shipped') AS has_shipment_event
    FROM public.orders o
    LEFT JOIN public.products p ON p.seller_id = o.seller_id AND p.name = o.product_name
    WHERE o.invoice_id = p_invoice_id
  ), shipping_lines AS (
    SELECT
      CASE WHEN CEIL(weight_kg * quantity) <= 1 THEN '≤1 KG' WHEN CEIL(weight_kg * quantity) <= 2 THEN '≤2 KG' WHEN CEIL(weight_kg * quantity) <= 3 THEN '≤3 KG' ELSE '>3 KG' END AS bracket,
      CASE WHEN CEIL(weight_kg * quantity) <= 1 THEN 1 WHEN CEIL(weight_kg * quantity) <= 2 THEN 2 WHEN CEIL(weight_kg * quantity) <= 3 THEN 3 ELSE 4 END AS sort_order,
      CASE WHEN CEIL(weight_kg * quantity) <= 1 THEN COALESCE(v_seller_rates.rate_1kg, 0) WHEN CEIL(weight_kg * quantity) <= 2 THEN COALESCE(v_seller_rates.rate_2kg, 0) WHEN CEIL(weight_kg * quantity) <= 3 THEN COALESCE(v_seller_rates.rate_3kg, 0) ELSE COALESCE(v_seller_rates.rate_3kg_plus, COALESCE(v_seller_rates.rate_3kg, 0)) END AS fee
    FROM invoice_orders WHERE has_shipment_event = true AND COALESCE(weight_kg, 0) > 0
  ), grouped AS (
    SELECT bracket, sort_order, COUNT(*)::integer AS order_count, COALESCE(SUM(fee), 0)::numeric AS fee_total
    FROM shipping_lines GROUP BY bracket, sort_order ORDER BY sort_order
  )
  SELECT COALESCE(SUM(fee_total), 0)::numeric,
    COALESCE(jsonb_agg(jsonb_build_object('bracket', bracket, 'count', order_count, 'fee', fee_total) ORDER BY sort_order), '[]'::jsonb)
  INTO v_shipping_fees, v_shipping_breakdown FROM grouped;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'invoice_id', invoice_id, 'type', type, 'amount', amount, 'reason', reason, 'created_at', created_at) ORDER BY created_at ASC), '[]'::jsonb),
    COALESCE(SUM(CASE WHEN type = 'out' THEN -amount ELSE amount END), 0)::numeric
  INTO v_addons, v_addon_net FROM public.invoice_addons WHERE invoice_id = p_invoice_id;

  -- Adjustments: include shipping_difference in the total
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'order_id', order_id, 'seller_id', seller_id, 'invoice_id', invoice_id,
    'applied_invoice_id', applied_invoice_id, 'old_status', old_status, 'new_status', new_status,
    'difference', difference, 'difference_usd', difference / 290.0,
    'shipping_difference', shipping_difference,
    'previous_shipping_fee', previous_shipping_fee, 'new_shipping_fee', new_shipping_fee,
    'total_adjustment', (difference + shipping_difference),
    'total_adjustment_usd', (difference + shipping_difference) / 290.0,
    'reason', reason, 'status', status, 'created_at', created_at
  ) ORDER BY created_at ASC), '[]'::jsonb),
    COALESCE(SUM((difference + shipping_difference) / 290.0), 0)::numeric
  INTO v_adjustments, v_adjustment_net FROM public.invoice_adjustments WHERE applied_invoice_id = p_invoice_id AND status = 'approved';

  v_call_center_fees := (COALESCE(v_all_period_count, 0) * COALESCE(v_dropped_rate, 0)) + (COALESCE(v_period_confirmed_count, 0) * COALESCE(v_confirmed_rate, 0));
  v_cod_fees := COALESCE(v_delivered_revenue_usd, 0) * (COALESCE(v_cod_fee_percentage, 0) / 100.0);
  v_net_payable := COALESCE(v_delivered_revenue_usd, 0) - COALESCE(v_shipping_fees, 0) - COALESCE(v_call_center_fees, 0) - COALESCE(v_cod_fees, 0) + COALESCE(v_addon_net, 0) + COALESCE(v_adjustment_net, 0) + COALESCE(v_previous_balance, 0);

  RETURN jsonb_build_object(
    'invoice', jsonb_build_object('id', v_invoice.id, 'invoice_number', v_invoice.invoice_number, 'seller_id', v_invoice.seller_id, 'status', v_invoice.status, 'created_at', v_invoice.created_at, 'finalized_at', v_invoice.finalized_at, 'paid_at', v_invoice.paid_at, 'paid_by', v_invoice.paid_by, 'payment_proof_url', v_invoice.payment_proof_url, 'previous_balance', COALESCE(v_previous_balance, 0)),
    'rates', jsonb_build_object('shipping', jsonb_build_object('rate_1kg', COALESCE(v_seller_rates.rate_1kg, 0), 'rate_2kg', COALESCE(v_seller_rates.rate_2kg, 0), 'rate_3kg', COALESCE(v_seller_rates.rate_3kg, 0), 'rate_3kg_plus', COALESCE(v_seller_rates.rate_3kg_plus, COALESCE(v_seller_rates.rate_3kg, 0))), 'call_center', jsonb_build_object('confirmed_rate', COALESCE(v_confirmed_rate, 0), 'dropped_rate', COALESCE(v_dropped_rate, 0)), 'cod_fee_percentage', COALESCE(v_cod_fee_percentage, 0)),
    'counts', jsonb_build_object('total_orders_count', COALESCE(v_all_period_count, 0), 'delivered_count', COALESCE(v_delivered_count, 0), 'shipped_count', COALESCE(v_shipped_count, 0), 'confirmed_count', COALESCE(v_period_confirmed_count, 0), 'dropped_count', COALESCE(v_all_period_count, 0)),
    'call_center_breakdown', jsonb_build_object('confirmed_count', COALESCE(v_period_confirmed_count, 0), 'confirmed_rate', COALESCE(v_confirmed_rate, 0), 'confirmed_fees', COALESCE(v_period_confirmed_count, 0) * COALESCE(v_confirmed_rate, 0), 'dropped_count', COALESCE(v_all_period_count, 0), 'dropped_rate', COALESCE(v_dropped_rate, 0), 'dropped_fees', COALESCE(v_all_period_count, 0) * COALESCE(v_dropped_rate, 0)),
    'delivered_orders', v_delivered_orders,
    'shipping_breakdown', v_shipping_breakdown,
    'addons', v_addons,
    'adjustments', v_adjustments,
    'totals', jsonb_build_object('delivered_revenue_usd', COALESCE(v_delivered_revenue_usd, 0), 'shipping_fees', COALESCE(v_shipping_fees, 0), 'call_center_fees', COALESCE(v_call_center_fees, 0), 'cod_fees', COALESCE(v_cod_fees, 0), 'addon_net', COALESCE(v_addon_net, 0), 'adjustment_net', COALESCE(v_adjustment_net, 0), 'previous_balance', COALESCE(v_previous_balance, 0), 'net_payable', COALESCE(v_net_payable, 0))
  );
END;
$function$;

-- Step 4: Update approve_invoice_adjustment to include shipping in audit
CREATE OR REPLACE FUNCTION public.approve_invoice_adjustment(p_adjustment_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_adj public.invoice_adjustments%ROWTYPE;
  v_open_invoice_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT * INTO v_adj FROM public.invoice_adjustments WHERE id = p_adjustment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Adjustment not found'; END IF;
  IF v_adj.status != 'pending' THEN RAISE EXCEPTION 'Adjustment is not pending'; END IF;

  SELECT id INTO v_open_invoice_id
  FROM public.invoices
  WHERE seller_id = v_adj.seller_id AND status = 'open'
  ORDER BY created_at DESC LIMIT 1;

  IF v_open_invoice_id IS NULL THEN
    INSERT INTO public.invoices (seller_id, status)
    VALUES (v_adj.seller_id, 'open')
    RETURNING id INTO v_open_invoice_id;
  END IF;

  UPDATE public.invoice_adjustments
  SET status = 'approved',
      applied_invoice_id = v_open_invoice_id,
      reviewed_by = auth.uid(),
      reviewed_at = now()
  WHERE id = p_adjustment_id;

  INSERT INTO public.invoice_history (invoice_id, event_type, field_changed, old_value, new_value, order_id, changed_by, description, metadata)
  VALUES (v_adj.invoice_id, 'adjustment_approved', 'status', 'pending', 'approved', v_adj.order_id, auth.uid(),
    'Adjustment approved: revenue ' || v_adj.difference || ' PKR, shipping ' || v_adj.shipping_difference || ' PKR',
    jsonb_build_object('difference', v_adj.difference, 'shipping_difference', v_adj.shipping_difference, 'total', v_adj.difference + v_adj.shipping_difference));

  INSERT INTO public.invoice_history (invoice_id, event_type, field_changed, old_value, new_value, order_id, changed_by, description, metadata)
  VALUES (v_open_invoice_id, 'adjustment_applied', 'adjustment', NULL, (v_adj.difference + v_adj.shipping_difference)::text, v_adj.order_id, auth.uid(),
    'Adjustment applied: total ' || (v_adj.difference + v_adj.shipping_difference) || ' PKR',
    jsonb_build_object('difference', v_adj.difference, 'shipping_difference', v_adj.shipping_difference));

  RETURN jsonb_build_object('success', true, 'applied_invoice_id', v_open_invoice_id);
END;
$function$;

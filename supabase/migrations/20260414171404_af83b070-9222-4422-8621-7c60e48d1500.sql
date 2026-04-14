-- Drop the old generic trigger
DROP TRIGGER IF EXISTS update_orders_updated_at ON public.orders;

-- Create a smarter trigger function for orders
CREATE OR REPLACE FUNCTION public.update_orders_updated_at_smart()
RETURNS TRIGGER AS $$
BEGIN
  -- Compare all fields EXCEPT background/sync fields and updated_at itself
  -- If only background fields changed, preserve the original updated_at
  IF to_jsonb(OLD) - ARRAY[
    'delivery_status','orio_shipping_status','orio_consignment_no',
    'orio_sync_status','orio_sync_error','orio_synced_at','orio_order_id',
    'delivered_at','shipping_status','shipping_cost',
    'updated_at','last_activity_at','invoice_id'
  ] IS NOT DISTINCT FROM to_jsonb(NEW) - ARRAY[
    'delivery_status','orio_shipping_status','orio_consignment_no',
    'orio_sync_status','orio_sync_error','orio_synced_at','orio_order_id',
    'delivered_at','shipping_status','shipping_cost',
    'updated_at','last_activity_at','invoice_id'
  ] THEN
    -- Only background fields changed → preserve updated_at
    NEW.updated_at := OLD.updated_at;
  ELSE
    -- User-facing fields changed → update timestamp
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Re-create the trigger with the smart function
CREATE TRIGGER update_orders_updated_at
BEFORE UPDATE ON public.orders
FOR EACH ROW
EXECUTE FUNCTION public.update_orders_updated_at_smart();
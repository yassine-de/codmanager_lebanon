
UPDATE rate_settings 
SET confirmed_order_rate = 0.3, dropped_order_rate = 0.2, is_custom = false, updated_at = now()
WHERE seller_id = '0af9dce8-098e-431c-a9b3-4abf87af92ce';

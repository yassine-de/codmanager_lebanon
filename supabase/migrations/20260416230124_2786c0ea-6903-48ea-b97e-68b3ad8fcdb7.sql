-- Add per-sheet column mapping (optional, defaults handled in code)
ALTER TABLE public.integration_sheets
ADD COLUMN IF NOT EXISTS column_mapping jsonb DEFAULT '{
  "order_id": "A",
  "customer_name": "B",
  "phone": "C",
  "address": "D",
  "city": "E",
  "product_name": "F",
  "sku": "G",
  "quantity": "H",
  "price": "I",
  "total": "J"
}'::jsonb;
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS wakilni_paid_at timestamptz,
  ADD COLUMN IF NOT EXISTS wakilni_paid_by uuid,
  ADD COLUMN IF NOT EXISTS wakilni_invoice_import_id uuid,
  ADD COLUMN IF NOT EXISTS wakilni_invoice_number text,
  ADD COLUMN IF NOT EXISTS wakilni_invoice_collection_usd numeric,
  ADD COLUMN IF NOT EXISTS wakilni_invoice_delivery_fee_usd numeric,
  ADD COLUMN IF NOT EXISTS wakilni_invoice_matched_at timestamptz;

CREATE TABLE IF NOT EXISTS public.wakilni_invoice_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text,
  file_name text NOT NULL,
  imported_by uuid REFERENCES auth.users(id),
  imported_at timestamptz NOT NULL DEFAULT now(),
  row_count integer NOT NULL DEFAULT 0,
  matched_count integer NOT NULL DEFAULT 0,
  newly_paid_count integer NOT NULL DEFAULT 0,
  already_paid_count integer NOT NULL DEFAULT 0,
  unmatched_count integer NOT NULL DEFAULT 0,
  amount_total_usd numeric NOT NULL DEFAULT 0,
  delivery_fee_total_usd numeric NOT NULL DEFAULT 0,
  notes text
);

CREATE TABLE IF NOT EXISTS public.wakilni_invoice_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  import_id uuid NOT NULL REFERENCES public.wakilni_invoice_imports(id) ON DELETE CASCADE,
  wakilni_order_id text,
  waybill text,
  recipient_name text,
  delivery_fee_usd numeric,
  collection_usd numeric,
  collection_type text,
  area text,
  invoice_date date,
  matched_order_id uuid REFERENCES public.orders(id),
  match_status text NOT NULL DEFAULT 'unmatched',
  mismatch_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_wakilni_paid_at ON public.orders(wakilni_paid_at);
CREATE INDEX IF NOT EXISTS idx_orders_wakilni_invoice_import_id ON public.orders(wakilni_invoice_import_id);
CREATE INDEX IF NOT EXISTS idx_wakilni_invoice_rows_import_id ON public.wakilni_invoice_rows(import_id);
CREATE INDEX IF NOT EXISTS idx_wakilni_invoice_rows_wakilni_order_id ON public.wakilni_invoice_rows(wakilni_order_id);
CREATE INDEX IF NOT EXISTS idx_wakilni_invoice_rows_waybill ON public.wakilni_invoice_rows(waybill);

ALTER TABLE public.wakilni_invoice_imports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wakilni_invoice_rows ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'wakilni_invoice_imports' AND policyname = 'Admins full access wakilni invoice imports'
  ) THEN
    CREATE POLICY "Admins full access wakilni invoice imports"
      ON public.wakilni_invoice_imports
      FOR ALL TO authenticated
      USING (public.is_admin(auth.uid()))
      WITH CHECK (public.is_admin(auth.uid()));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'wakilni_invoice_rows' AND policyname = 'Admins full access wakilni invoice rows'
  ) THEN
    CREATE POLICY "Admins full access wakilni invoice rows"
      ON public.wakilni_invoice_rows
      FOR ALL TO authenticated
      USING (public.is_admin(auth.uid()))
      WITH CHECK (public.is_admin(auth.uid()));
  END IF;
END $$;

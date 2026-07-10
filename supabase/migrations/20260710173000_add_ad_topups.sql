CREATE TABLE IF NOT EXISTS public.ad_topups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id uuid NOT NULL,
  invoice_id uuid REFERENCES public.invoices(id) ON DELETE SET NULL,
  invoice_addon_id uuid REFERENCES public.invoice_addons(id) ON DELETE SET NULL,
  created_by uuid,
  ad_account_name text NOT NULL,
  amount_usd numeric NOT NULL CHECK (amount_usd > 0),
  topup_date date NOT NULL DEFAULT CURRENT_DATE,
  note text,
  source text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'invoiced', 'paid', 'cancelled')),
  invoiced_at timestamptz,
  paid_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ad_topups_seller_status ON public.ad_topups (seller_id, status, topup_date DESC);
CREATE INDEX IF NOT EXISTS idx_ad_topups_invoice_id ON public.ad_topups (invoice_id);

ALTER TABLE public.ad_topups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage ad topups"
ON public.ad_topups
FOR ALL
TO authenticated
USING (public.is_admin(auth.uid()))
WITH CHECK (public.is_admin(auth.uid()));

CREATE POLICY "Sellers view own ad topups"
ON public.ad_topups
FOR SELECT
TO authenticated
USING (seller_id = auth.uid());

CREATE OR REPLACE FUNCTION public.set_ad_topups_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_ad_topups_updated_at ON public.ad_topups;
CREATE TRIGGER trg_set_ad_topups_updated_at
BEFORE UPDATE ON public.ad_topups
FOR EACH ROW
EXECUTE FUNCTION public.set_ad_topups_updated_at();

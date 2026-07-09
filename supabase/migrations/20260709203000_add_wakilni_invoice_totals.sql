ALTER TABLE public.wakilni_invoice_imports
  ADD COLUMN IF NOT EXISTS total_collection_usd numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_wk_fees_usd numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS grand_total_usd numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_collection_lbp numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_wk_fees_lbp numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS grand_total_lbp numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS warnings_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processing_status text NOT NULL DEFAULT 'processed',
  ADD COLUMN IF NOT EXISTS processing_summary jsonb NOT NULL DEFAULT '{}'::jsonb;

UPDATE public.wakilni_invoice_imports
SET total_collection_usd = COALESCE(NULLIF(total_collection_usd, 0), amount_total_usd, 0),
    total_wk_fees_usd = COALESCE(NULLIF(total_wk_fees_usd, 0), delivery_fee_total_usd, 0),
    grand_total_usd = CASE
      WHEN COALESCE(grand_total_usd, 0) = 0 THEN COALESCE(amount_total_usd, 0) - COALESCE(delivery_fee_total_usd, 0)
      ELSE grand_total_usd
    END,
    warnings_count = COALESCE(NULLIF(warnings_count, 0), 0),
    processing_summary = CASE
      WHEN processing_summary = '{}'::jsonb THEN jsonb_build_object(
        'row_count', row_count,
        'matched_count', matched_count,
        'newly_paid_count', newly_paid_count,
        'already_paid_count', already_paid_count,
        'unmatched_count', unmatched_count
      )
      ELSE processing_summary
    END;

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS ai_context text,
  ADD COLUMN IF NOT EXISTS ai_context_scraped_at timestamp with time zone;
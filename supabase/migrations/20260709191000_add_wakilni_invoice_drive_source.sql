ALTER TABLE public.wakilni_invoice_imports
  ADD COLUMN IF NOT EXISTS google_drive_file_id text,
  ADD COLUMN IF NOT EXISTS google_drive_file_name text,
  ADD COLUMN IF NOT EXISTS google_drive_web_view_link text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_wakilni_invoice_imports_google_drive_file_id
  ON public.wakilni_invoice_imports(google_drive_file_id)
  WHERE google_drive_file_id IS NOT NULL;

INSERT INTO public.app_settings (key, value, updated_at)
VALUES
  ('wakilni_invoice_drive_folder_id', '1hpDtSIx3pzc7r5gm9LuSS28ALikhTBJr', now())
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = now();

-- Cache Wakilni delivery areas for Lebanon city/area selection.
CREATE TABLE IF NOT EXISTS public.wakilni_areas_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  area_id integer NOT NULL UNIQUE,
  area_name text NOT NULL,
  parent_id integer,
  raw_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_updated timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.wakilni_areas_cache ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can read wakilni areas" ON public.wakilni_areas_cache;
CREATE POLICY "Authenticated can read wakilni areas"
  ON public.wakilni_areas_cache
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins can manage wakilni areas" ON public.wakilni_areas_cache;
CREATE POLICY "Admins can manage wakilni areas"
  ON public.wakilni_areas_cache
  FOR ALL
  TO authenticated
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

CREATE INDEX IF NOT EXISTS idx_wakilni_areas_cache_area_name
  ON public.wakilni_areas_cache (area_name);

CREATE OR REPLACE FUNCTION public.update_wakilni_areas_cache_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS update_wakilni_areas_cache_updated_at ON public.wakilni_areas_cache;
CREATE TRIGGER update_wakilni_areas_cache_updated_at
  BEFORE UPDATE ON public.wakilni_areas_cache
  FOR EACH ROW
  EXECUTE FUNCTION public.update_wakilni_areas_cache_updated_at();

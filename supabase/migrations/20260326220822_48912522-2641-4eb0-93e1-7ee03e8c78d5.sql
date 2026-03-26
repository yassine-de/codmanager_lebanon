
CREATE TABLE public.user_presence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  last_seen timestamp with time zone NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true
);

ALTER TABLE public.user_presence ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view presence"
  ON public.user_presence FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can upsert own presence"
  ON public.user_presence FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own presence"
  ON public.user_presence FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

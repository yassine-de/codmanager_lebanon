-- WhatsApp Automations: store automation flows (trigger + steps as JSON graph)
CREATE TABLE public.whatsapp_automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT 'Untitled',
  description text,
  status text NOT NULL DEFAULT 'draft', -- draft | active | paused
  trigger_type text NOT NULL, -- new_order | confirmation_status_changed | delivery_status_changed | follow_up_status_changed | new_contact | tag_added | tag_removed | campaign_finished
  trigger_config jsonb NOT NULL DEFAULT '{}'::jsonb, -- e.g. { "from": "new", "to": "confirmed" }
  nodes jsonb NOT NULL DEFAULT '[]'::jsonb, -- array of { id, type, position, data }
  edges jsonb NOT NULL DEFAULT '[]'::jsonb, -- array of { id, source, target, sourceHandle? }
  runs_count integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  last_run_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_whatsapp_automations_status ON public.whatsapp_automations(status);
CREATE INDEX idx_whatsapp_automations_trigger ON public.whatsapp_automations(trigger_type);

ALTER TABLE public.whatsapp_automations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can do anything on automations"
  ON public.whatsapp_automations FOR ALL
  USING (public.is_admin(auth.uid()))
  WITH CHECK (public.is_admin(auth.uid()));

-- Run history: each execution + outcome
CREATE TABLE public.whatsapp_automation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id uuid NOT NULL REFERENCES public.whatsapp_automations(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending', -- pending | success | failed | skipped
  trigger_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  steps_log jsonb NOT NULL DEFAULT '[]'::jsonb, -- [{ step_id, type, status, output, error, ms }]
  error_message text,
  customer_phone text,
  order_id text,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX idx_automation_runs_automation ON public.whatsapp_automation_runs(automation_id, started_at DESC);
CREATE INDEX idx_automation_runs_status ON public.whatsapp_automation_runs(status);

ALTER TABLE public.whatsapp_automation_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view automation runs"
  ON public.whatsapp_automation_runs FOR SELECT
  USING (public.is_admin(auth.uid()));

CREATE POLICY "Admins can insert automation runs"
  ON public.whatsapp_automation_runs FOR INSERT
  WITH CHECK (public.is_admin(auth.uid()));

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_whatsapp_automations_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_whatsapp_automations_updated
  BEFORE UPDATE ON public.whatsapp_automations
  FOR EACH ROW EXECUTE FUNCTION public.touch_whatsapp_automations_updated_at();
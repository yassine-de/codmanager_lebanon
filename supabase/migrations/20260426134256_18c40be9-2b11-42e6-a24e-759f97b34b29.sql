-- Add labels and pending intent to whatsapp_conversations for AI-gated button actions
ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS labels text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS pending_button_intent jsonb;

CREATE INDEX IF NOT EXISTS idx_wa_conv_labels ON public.whatsapp_conversations USING GIN (labels);
CREATE INDEX IF NOT EXISTS idx_wa_conv_pending_intent ON public.whatsapp_conversations ((pending_button_intent IS NOT NULL));

COMMENT ON COLUMN public.whatsapp_conversations.labels IS 'Free-form labels added by AI (e.g. wants_human_agent_discount) so agents can filter conversations';
COMMENT ON COLUMN public.whatsapp_conversations.pending_button_intent IS 'When a customer clicks a button but AI is gating, stores the desired outcome (e.g. {"intent":"confirm","mapped_status":"confirmed","button_text":"Confirm","auto_takeover_at":"2025-..."}) until AI validates and applies it';
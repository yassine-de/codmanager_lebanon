ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS ai_enabled boolean NOT NULL DEFAULT true;
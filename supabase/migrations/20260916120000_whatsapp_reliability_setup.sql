-- Bring Lebanon's WhatsApp foundation in line with the stable Pakistan setup.
-- These changes are intentionally defensive/idempotent so they can be applied
-- to an existing project without recreating WhatsApp data.

ALTER TABLE public.whatsapp_conversations
  ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz;

ALTER TABLE public.whatsapp_messages
  ADD COLUMN IF NOT EXISTS sent_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;

UPDATE public.whatsapp_settings
SET default_country_code = '961'
WHERE default_country_code IS NULL OR default_country_code = '92';

CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_sent_by_created_at
  ON public.whatsapp_messages (sent_by, created_at)
  WHERE sent_by IS NOT NULL;

DO $$
BEGIN
  CREATE TEMP TABLE _dup_conv_keeper AS
  WITH dupes AS (
    SELECT order_id
    FROM public.whatsapp_conversations
    WHERE order_id IS NOT NULL
    GROUP BY order_id
    HAVING count(*) > 1
  ),
  ranked AS (
    SELECT
      c.id,
      c.order_id,
      (SELECT count(*) FROM public.whatsapp_messages m WHERE m.conversation_id = c.id) AS msg_count,
      c.last_message_at,
      c.created_at,
      row_number() OVER (
        PARTITION BY c.order_id
        ORDER BY
          (SELECT count(*) FROM public.whatsapp_messages m WHERE m.conversation_id = c.id) DESC,
          c.last_message_at DESC NULLS LAST,
          c.created_at ASC
      ) AS rn
    FROM public.whatsapp_conversations c
    JOIN dupes d ON d.order_id = c.order_id
  )
  SELECT order_id, id AS keeper_id
  FROM ranked
  WHERE rn = 1;

  UPDATE public.whatsapp_messages m
  SET conversation_id = k.keeper_id
  FROM public.whatsapp_conversations c
  JOIN _dup_conv_keeper k ON k.order_id = c.order_id
  WHERE m.conversation_id = c.id AND c.id <> k.keeper_id;

  UPDATE public.whatsapp_ai_suggestions m
  SET conversation_id = k.keeper_id
  FROM public.whatsapp_conversations c
  JOIN _dup_conv_keeper k ON k.order_id = c.order_id
  WHERE m.conversation_id = c.id AND c.id <> k.keeper_id;

  UPDATE public.whatsapp_automation_runs m
  SET conversation_id = k.keeper_id
  FROM public.whatsapp_conversations c
  JOIN _dup_conv_keeper k ON k.order_id = c.order_id
  WHERE m.conversation_id = c.id AND c.id <> k.keeper_id;

  UPDATE public.whatsapp_campaign_recipients m
  SET conversation_id = k.keeper_id
  FROM public.whatsapp_conversations c
  JOIN _dup_conv_keeper k ON k.order_id = c.order_id
  WHERE m.conversation_id = c.id AND c.id <> k.keeper_id;

  UPDATE public.whatsapp_ai_memory m
  SET conversation_id = k.keeper_id
  FROM public.whatsapp_conversations c
  JOIN _dup_conv_keeper k ON k.order_id = c.order_id
  WHERE m.conversation_id = c.id AND c.id <> k.keeper_id;

  DELETE FROM public.whatsapp_conversations c
  USING _dup_conv_keeper k
  WHERE c.order_id = k.order_id AND c.id <> k.keeper_id;

  DROP TABLE _dup_conv_keeper;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_conversations_order_unique
  ON public.whatsapp_conversations (order_id)
  WHERE order_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.get_conversation_last_messages()
RETURNS TABLE(conversation_id uuid, direction text, message_type text, body text, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (m.conversation_id)
    m.conversation_id, m.direction, m.message_type, m.body, m.created_at
  FROM public.whatsapp_messages m
  WHERE m.message_type <> 'note'
    AND public.is_admin(auth.uid())
  ORDER BY m.conversation_id, m.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.get_conversation_last_messages() TO authenticated;

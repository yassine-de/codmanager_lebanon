-- 1) Backfill last_message_at from actual last message per conversation
UPDATE public.whatsapp_conversations c
SET last_message_at = sub.max_created
FROM (
  SELECT conversation_id, MAX(created_at) AS max_created
  FROM public.whatsapp_messages
  GROUP BY conversation_id
) sub
WHERE sub.conversation_id = c.id
  AND (c.last_message_at IS NULL OR c.last_message_at < sub.max_created);

-- 2) Trigger: auto-update conversation.last_message_at on every new message
CREATE OR REPLACE FUNCTION public.update_conversation_last_message_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.whatsapp_conversations
  SET last_message_at = NEW.created_at
  WHERE id = NEW.conversation_id
    AND (last_message_at IS NULL OR last_message_at < NEW.created_at);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_update_conv_last_message_at ON public.whatsapp_messages;
CREATE TRIGGER trg_update_conv_last_message_at
AFTER INSERT ON public.whatsapp_messages
FOR EACH ROW
EXECUTE FUNCTION public.update_conversation_last_message_at();
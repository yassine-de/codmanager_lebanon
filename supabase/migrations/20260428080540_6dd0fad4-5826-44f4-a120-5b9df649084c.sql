UPDATE public.whatsapp_conversations
SET pending_button_intent = NULL
WHERE id = '8c988c83-7ee1-4f1b-914d-cdda72a1b0e9'
  AND pending_button_intent IS NOT NULL;
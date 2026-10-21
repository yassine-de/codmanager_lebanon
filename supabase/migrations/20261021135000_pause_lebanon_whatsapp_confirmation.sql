UPDATE public.whatsapp_automations
SET
  status = 'draft',
  trigger_config = jsonb_set(
    COALESCE(trigger_config, '{}'::jsonb),
    '{switch_to_agent}',
    '{"enabled": false}'::jsonb,
    true
  ),
  updated_at = now()
WHERE id = 'fb4bf6e8-2d8b-4350-a51c-ad143939a081'
  AND trigger_type = 'new_order';

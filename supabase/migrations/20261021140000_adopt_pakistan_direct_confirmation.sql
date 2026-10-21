UPDATE public.whatsapp_automations
SET
  nodes = (
    SELECT jsonb_agg(
      CASE
        WHEN node->>'id' = 'confirm_delivery_address' THEN
          jsonb_set(
            node #- '{data,buttons}' #- '{data,button_actions}',
            '{data,prompt}',
            to_jsonb(
              'The customer has confirmed the purchase. Reply briefly in the customer''s language. If the stored address is complete, thank them and say the order is confirmed and the courier will call on arrival. Do not ask them to confirm the address again. If the address is missing or vague, ask once for the complete delivery address: city or area, street, building or house, floor, and nearest landmark when available. Do not claim confirmation until a complete address is received.'::text
            ),
            true
          )
        ELSE node
      END
      ORDER BY ordinality
    )
    FROM jsonb_array_elements(nodes) WITH ORDINALITY AS items(node, ordinality)
    WHERE node->>'id' NOT IN ('address_confirmed_message', 'request_new_address')
  ),
  edges = (
    SELECT COALESCE(jsonb_agg(edge ORDER BY ordinality), '[]'::jsonb)
    FROM jsonb_array_elements(edges) WITH ORDINALITY AS items(edge, ordinality)
    WHERE edge->>'id' NOT IN ('address_correct_to_done', 'address_change_to_collect')
  ),
  updated_at = now()
WHERE id = 'fb4bf6e8-2d8b-4350-a51c-ad143939a081'
  AND trigger_type = 'new_order'
  AND status = 'draft';

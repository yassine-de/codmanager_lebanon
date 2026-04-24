UPDATE public.orders 
SET confirmation_status='confirmed', 
    confirmation_channel='whatsapp', 
    confirmed_at=now(), 
    whatsapp_status='confirmed', 
    updated_at=now() 
WHERE order_id='AB-266';

UPDATE public.whatsapp_conversations 
SET status='confirmed', updated_at=now() 
WHERE order_id='AB-266';
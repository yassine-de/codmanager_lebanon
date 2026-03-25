ALTER TABLE public.sourcing_requests 
ADD COLUMN payment_status text NOT NULL DEFAULT 'unpaid',
ADD COLUMN payment_method text DEFAULT NULL;
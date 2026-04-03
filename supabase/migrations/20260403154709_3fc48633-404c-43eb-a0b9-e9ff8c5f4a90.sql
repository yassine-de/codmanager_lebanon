
-- Add new columns to order_history for enhanced tracking
ALTER TABLE public.order_history 
  ADD COLUMN IF NOT EXISTS action_type text NOT NULL DEFAULT 'edit',
  ADD COLUMN IF NOT EXISTS attempt_number integer,
  ADD COLUMN IF NOT EXISTS group_id text;

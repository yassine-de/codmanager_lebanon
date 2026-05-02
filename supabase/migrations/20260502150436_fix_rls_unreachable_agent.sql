-- Fix RLS: allow agents to update orders to "unreachable" status even when agent_id is cleared.
-- The previous policy only covered 'no_answer' and 'postponed' in WITH CHECK,
-- but not 'unreachable' (auto-set on 9th no_answer attempt).
-- This blocked agents who processed orphaned orders (original_agent_id != auth.uid()).

DROP POLICY IF EXISTS "Agents can release their own orders on status change" ON public.orders;

CREATE POLICY "Agents can release their own orders on status change"
ON public.orders
FOR UPDATE TO authenticated
USING (auth.uid() = agent_id)
WITH CHECK (
  (
    agent_id IS NULL
    AND confirmation_status IN ('no_answer', 'postponed', 'unreachable')
  )
  OR
  (
    auth.uid() = agent_id
  )
);

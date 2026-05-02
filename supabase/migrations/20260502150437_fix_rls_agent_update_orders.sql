-- Fix: agents cannot submit no_answer / postponed because the WITH CHECK on
-- "Agents can update assigned orders" requires agent_id = auth.uid() even after
-- the update, but no_answer and postponed intentionally clear agent_id to null.
--
-- Drop every overlapping agent UPDATE policy and replace with one clear policy
-- that covers all cases: confirmed, cancelled, no_answer, postponed, unreachable.

DROP POLICY IF EXISTS "Agents can update assigned orders"                     ON public.orders;
DROP POLICY IF EXISTS "Agents can release their own orders on status change"  ON public.orders;

-- Single policy: agent owns the order now (USING) and the new row is valid (WITH CHECK).
-- Valid new rows:
--   a) agent keeps ownership  → confirmed, cancelled, double (agent_id stays)
--   b) agent releases lock    → no_answer, postponed, unreachable (agent_id → null)
CREATE POLICY "Agents can update assigned orders"
ON public.orders
FOR UPDATE TO authenticated
USING (
  auth.uid() = agent_id
)
WITH CHECK (
  auth.uid() = agent_id
  OR (
    agent_id IS NULL
    AND confirmation_status IN ('no_answer', 'postponed', 'unreachable')
  )
);

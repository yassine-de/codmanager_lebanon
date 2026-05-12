-- The WITH CHECK on "Agents can update assigned orders" was too restrictive,
-- blocking agents from updating orders in certain edge cases (e.g. cross-agent
-- no_answer claims, callback reclaims). The USING clause already guarantees
-- the agent owns the current row (agent_id = auth.uid()), so we relax
-- WITH CHECK to allow any transition they perform on their own row.

DROP POLICY IF EXISTS "Agents can update assigned orders" ON public.orders;

CREATE POLICY "Agents can update assigned orders"
ON public.orders
FOR UPDATE TO authenticated
USING (auth.uid() = agent_id)
WITH CHECK (
  -- Agent keeps ownership (confirmed, cancelled, double, etc.)
  auth.uid() = agent_id
  OR
  -- Agent releases order back to pool (no_answer, postponed, unreachable)
  agent_id IS NULL
  OR
  -- Agent is the original handler — covers callback reclaims
  auth.uid() = original_agent_id
);

NOTIFY pgrst, 'reload schema';

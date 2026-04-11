CREATE POLICY "Agents can release their own orders on status change"
ON public.orders FOR UPDATE
TO authenticated
USING (auth.uid() = agent_id)
WITH CHECK (
  (
    agent_id IS NULL
    AND confirmation_status IN ('no_answer', 'postponed')
  )
  OR
  (
    auth.uid() = agent_id
  )
);
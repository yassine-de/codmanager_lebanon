CREATE POLICY "Agents can update orders they originally treated"
ON public.orders
FOR UPDATE TO authenticated
USING (
  auth.uid() = original_agent_id
  AND confirmation_status <> 'new'
  AND EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_roles.user_id = auth.uid()
    AND user_roles.role = 'agent'
  )
)
WITH CHECK (
  (agent_id IS NULL OR agent_id = auth.uid())
);
-- Allow agents to see unassigned new orders (so they can claim them)
CREATE POLICY "Agents can view unassigned new orders"
ON public.orders
FOR SELECT
TO authenticated
USING (
  agent_id IS NULL 
  AND confirmation_status = 'new'
  AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'agent')
);

-- Allow agents to claim unassigned orders (update agent_id)
CREATE POLICY "Agents can claim unassigned orders"
ON public.orders
FOR UPDATE
TO authenticated
USING (
  agent_id IS NULL 
  AND confirmation_status = 'new'
  AND EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'agent')
);

-- Order history table for tracking changes
CREATE TABLE public.order_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id text NOT NULL,
  changed_by uuid NOT NULL,
  changed_by_role text NOT NULL,
  field_changed text NOT NULL,
  old_value text,
  new_value text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.order_history ENABLE ROW LEVEL SECURITY;

-- Admins full access
CREATE POLICY "Admins full access order_history"
ON public.order_history FOR ALL TO authenticated
USING (is_admin(auth.uid()))
WITH CHECK (is_admin(auth.uid()));

-- Agents can insert history
CREATE POLICY "Agents can insert order_history"
ON public.order_history FOR INSERT TO authenticated
WITH CHECK (auth.uid() = changed_by);

-- Agents can view history of their orders
CREATE POLICY "Agents can view own history"
ON public.order_history FOR SELECT TO authenticated
USING (auth.uid() = changed_by);

-- Sellers can view history of their orders
CREATE POLICY "Sellers can view order history"
ON public.order_history FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.orders o 
    WHERE o.order_id = order_history.order_id 
    AND o.seller_id = auth.uid()
  )
);
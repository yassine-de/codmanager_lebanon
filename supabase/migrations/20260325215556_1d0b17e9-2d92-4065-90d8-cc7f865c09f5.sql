CREATE POLICY "Sellers can insert own orders"
ON public.orders
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = seller_id);
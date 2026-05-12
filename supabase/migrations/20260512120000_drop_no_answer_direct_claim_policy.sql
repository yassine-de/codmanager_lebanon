-- Drop the RLS policy that allowed original agents to directly PATCH-claim their
-- own unassigned no_answer orders. Claiming is now exclusively handled by the
-- SECURITY DEFINER RPCs (claim_next_order / reclaim_no_answer_order) which
-- already enforce all business rules and prevent race conditions.

DROP POLICY IF EXISTS "Agents can claim own released no_answer orders" ON public.orders;

NOTIFY pgrst, 'reload schema';

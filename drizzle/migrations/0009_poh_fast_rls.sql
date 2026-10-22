DROP POLICY IF EXISTS "Admins read ownership history" ON public.person_ownership_history;
CREATE POLICY "Admins read ownership history" ON public.person_ownership_history FOR SELECT TO authenticated
USING ((SELECT public.has_role(auth.uid(), 'admin')));
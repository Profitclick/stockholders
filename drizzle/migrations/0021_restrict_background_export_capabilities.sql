REVOKE ALL ON public.background_exports FROM anon, authenticated;
GRANT SELECT(id,created_by,source,filters,status,row_count,cursor,parts,error,created_at,updated_at,lease_until) ON public.background_exports TO authenticated;
GRANT ALL ON public.background_exports TO service_role;
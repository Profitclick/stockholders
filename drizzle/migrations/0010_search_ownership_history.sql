CREATE OR REPLACE FUNCTION public.search_ownership_history(p_prefix text, p_limit integer DEFAULT 1000)
RETURNS SETOF public.person_ownership_history
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_prefix IS NULL OR length(trim(p_prefix)) < 2 THEN RETURN; END IF;
  RETURN QUERY
    SELECT * FROM public.person_ownership_history h
    WHERE h.shareholder_name LIKE upper(trim(p_prefix)) || '%'
       OR h.company LIKE upper(trim(p_prefix)) || '%'
    LIMIT least(coalesce(p_limit, 1000), 2000);
END $$;
REVOKE ALL ON FUNCTION public.search_ownership_history(text, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_ownership_history(text, integer) TO authenticated;
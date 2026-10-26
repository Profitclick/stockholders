CREATE OR REPLACE FUNCTION public.ownership_export_page(p_after_id bigint DEFAULT 0, p_limit integer DEFAULT 1000, p_prefix text DEFAULT '', p_orgnr text DEFAULT NULL, p_person text DEFAULT NULL, p_birth_year integer DEFAULT NULL, p_trend text DEFAULT 'all', p_min_pct numeric DEFAULT 0)
RETURNS SETOF public.person_ownership_history
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_prefix text := upper(regexp_replace(trim(coalesce(p_prefix, '')), '[%_\\]', '', 'g'));
BEGIN
 IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
 IF p_person IS NULL AND p_orgnr IS NULL AND length(v_prefix) = 1 THEN RETURN; END IF;
 RETURN QUERY SELECT h.* FROM public.person_ownership_history h
 WHERE h.id > coalesce(p_after_id, 0)
 AND (p_person IS NULL OR (h.shareholder_name = p_person AND h.birth_year IS NOT DISTINCT FROM p_birth_year))
 AND (p_person IS NOT NULL OR p_orgnr IS NULL OR h.orgnr = p_orgnr)
 AND (p_person IS NOT NULL OR p_orgnr IS NOT NULL OR v_prefix = '' OR h.shareholder_name LIKE v_prefix || '%' OR h.company LIKE v_prefix || '%')
 AND (p_person IS NOT NULL OR coalesce(p_trend, 'all') = 'all' OR h.trend = p_trend)
 AND (p_person IS NOT NULL OR coalesce(p_min_pct, 0) <= 0 OR h.max_pct >= p_min_pct)
 ORDER BY h.id LIMIT greatest(1, least(coalesce(p_limit, 1000), 1000));
END $$;
REVOKE ALL ON FUNCTION public.ownership_export_page(bigint, integer, text, text, text, integer, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ownership_export_page(bigint, integer, text, text, text, integer, text, numeric) TO authenticated;
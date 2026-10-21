CREATE OR REPLACE FUNCTION public.ownership_ai_context(q text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  lq text := lower(coalesce(q,''));
  orgs text[];
  result jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT coalesce(array_agg(DISTINCT m[1]), '{}') INTO orgs
  FROM regexp_matches(lq, '(\d{9})', 'g') AS m;

  SELECT array_cat(orgs, coalesce(array_agg(orgnr), '{}')) INTO orgs FROM (
    SELECT orgnr FROM company_signals
    WHERE length(regexp_replace(lower(name), '\s+(as|asa|sa|ans|da)$', '')) >= 4
      AND position(regexp_replace(lower(name), '\s+(as|asa|sa|ans|da)$', '') IN lq) > 0
    ORDER BY trigger_count DESC LIMIT 8) s;

  SELECT jsonb_build_object(
    'scope', 'Aksjonærregisteret 2024 vs 2025, aggregert. Ingen personnavn.',
    'trigger_totals', (SELECT jsonb_object_agg(trigger_type, n) FROM (SELECT trigger_type, count(*) n FROM investor_triggers GROUP BY 1) t),
    'person_owner_changes_total', (SELECT jsonb_object_agg(change_type, n) FROM (SELECT change_type, count(*) n FROM person_holdings GROUP BY 1) t),
    'person_changes_by_birth_decade', (SELECT jsonb_agg(x) FROM (
      SELECT (birth_year/10*10)::text || '-tallet' AS decade, change_type, count(*) n
      FROM person_holdings WHERE birth_year IS NOT NULL GROUP BY 1,2 HAVING count(*) >= 5 ORDER BY 1,2) x),
    'top_municipalities_majority_change', (SELECT jsonb_agg(x) FROM (
      SELECT municipality, count(*) companies, round(avg(lead_score)) avg_score FROM company_signals
      WHERE has_majority_change AND municipality IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 15) x),
    'top_industries_majority_change', (SELECT jsonb_agg(x) FROM (
      SELECT industry, count(*) companies FROM company_signals
      WHERE has_majority_change AND industry IS NOT NULL GROUP BY 1 ORDER BY 2 DESC LIMIT 15) x),
    'municipality_matches', (SELECT jsonb_agg(x) FROM (
      SELECT municipality, count(*) companies,
        count(*) FILTER (WHERE has_majority_change) majority_changes,
        count(*) FILTER (WHERE has_new_shareholder) new_shareholder,
        count(*) FILTER (WHERE has_capital_increase) capital_increase
      FROM company_signals WHERE municipality IS NOT NULL AND length(municipality) >= 3
        AND position(lower(municipality) IN lq) > 0 GROUP BY 1 LIMIT 5) x),
    'company_matches', (SELECT jsonb_agg(x) FROM (
      SELECT c.orgnr, c.name, c.municipality, c.industry, c.revenue, c.lead_score,
        c.has_majority_change, c.has_new_shareholder, c.has_capital_increase,
        (SELECT jsonb_agg(jsonb_build_object('type', t.trigger_type,
            'pct_2024', t.metadata->'pct_2024', 'pct_2025', t.metadata->'pct_2025'))
          FROM investor_triggers t WHERE t.orgnr = c.orgnr) AS ownership_events,
        (SELECT jsonb_object_agg(change_type, n) FROM (SELECT change_type, count(*) n FROM person_holdings p WHERE p.orgnr = c.orgnr GROUP BY 1) z) AS person_owner_changes
      FROM company_signals c WHERE c.orgnr = ANY(orgs) LIMIT 10) x)
  ) INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.ownership_ai_context(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.ownership_ai_context(text) TO authenticated;
CREATE OR REPLACE FUNCTION public.aggregate_investors(p_after_name text DEFAULT NULL::text, p_limit integer DEFAULT 500)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_last_key TEXT;
  v_processed_count INT := 0;
  v_limit INT := LEAST(GREATEST(COALESCE(p_limit, 500), 1), 1000);
  v_names TEXT[];
BEGIN
  PERFORM set_config('statement_timeout', '240s', true);

  SELECT array_agg(n) INTO v_names
  FROM (
    SELECT DISTINCT sr.shareholder_name AS n
    FROM public.shareholder_raw sr
    WHERE sr.shareholder_name IS NOT NULL
      AND sr.shareholder_name <> ''
      AND sr.shareholder_name <> '-'
      AND (p_after_name IS NULL OR sr.shareholder_name > p_after_name)
    ORDER BY sr.shareholder_name
    LIMIT v_limit
  ) sub;

  IF v_names IS NULL OR array_length(v_names, 1) IS NULL THEN
    RETURN jsonb_build_object('processed_count', 0, 'last_key', p_after_name, 'done', true);
  END IF;

  v_last_key := v_names[array_length(v_names, 1)];

  WITH aggregated_data AS (
    SELECT
      sr.shareholder_name,
      MIN(NULLIF(sr.shareholder_type, '')) AS shareholder_type,
      MIN(sr.birth_year) FILTER (WHERE sr.birth_year IS NOT NULL) AS birth_year,
      MIN(NULLIF(sr.gender, '')) AS gender,
      MIN(NULLIF(sr.municipality, '')) AS municipality,
      COUNT(DISTINCT NULLIF(sr.orgnr, ''))::integer AS portfolio_size,
      COALESCE(SUM(COALESCE(sr.shares, 0)), 0)::double precision AS capital_estimate
    FROM public.shareholder_raw sr
    WHERE sr.shareholder_name = ANY(v_names)
    GROUP BY sr.shareholder_name
  ),
  upserted AS (
    INSERT INTO public.investors (
      name, type, birth_year, gender, municipality,
      portfolio_size, portfolio_companies, capital_estimate
    )
    SELECT
      ad.shareholder_name,
      ad.shareholder_type,
      ad.birth_year,
      ad.gender,
      ad.municipality,
      COALESCE(ad.portfolio_size, 0),
      '[]'::jsonb,
      COALESCE(ad.capital_estimate, 0)
    FROM aggregated_data ad
    ON CONFLICT (name) DO UPDATE SET
      type = COALESCE(EXCLUDED.type, investors.type),
      birth_year = COALESCE(EXCLUDED.birth_year, investors.birth_year),
      gender = COALESCE(EXCLUDED.gender, investors.gender),
      municipality = COALESCE(EXCLUDED.municipality, investors.municipality),
      portfolio_size = EXCLUDED.portfolio_size,
      portfolio_companies = EXCLUDED.portfolio_companies,
      capital_estimate = EXCLUDED.capital_estimate,
      updated_at = now()
    RETURNING name
  )
  SELECT COUNT(*) INTO v_processed_count FROM upserted;

  RETURN jsonb_build_object(
    'processed_count', v_processed_count,
    'last_key', v_last_key,
    'done', false
  );
END;
$function$;

-- Add indexes to speed up keyset pagination in aggregate functions
CREATE INDEX IF NOT EXISTS idx_shareholder_raw_shareholder_name ON public.shareholder_raw (shareholder_name);
CREATE INDEX IF NOT EXISTS idx_shareholder_raw_orgnr ON public.shareholder_raw (orgnr);

-- Reduce batch size and increase timeout in the aggregate functions
CREATE OR REPLACE FUNCTION public.aggregate_investors(p_after_name text DEFAULT NULL::text, p_limit integer DEFAULT 5000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_last_key TEXT;
  v_processed_count INT := 0;
  v_limit INT := LEAST(GREATEST(COALESCE(p_limit, 5000), 1), 10000);
BEGIN
  PERFORM set_config('statement_timeout', '240s', true);

  WITH batch_names AS (
    SELECT sr.shareholder_name
    FROM public.shareholder_raw sr
    WHERE sr.shareholder_name IS NOT NULL
      AND sr.shareholder_name <> ''
      AND sr.shareholder_name <> '-'
      AND (p_after_name IS NULL OR sr.shareholder_name > p_after_name)
    GROUP BY sr.shareholder_name
    ORDER BY sr.shareholder_name
    LIMIT v_limit
  ),
  base_profile AS (
    SELECT
      sr.shareholder_name,
      MODE() WITHIN GROUP (ORDER BY sr.shareholder_type) AS stype,
      MIN(sr.birth_year) FILTER (WHERE sr.birth_year IS NOT NULL) AS birth_year,
      MODE() WITHIN GROUP (ORDER BY sr.gender) FILTER (WHERE sr.gender IS NOT NULL) AS gender,
      MODE() WITHIN GROUP (ORDER BY sr.municipality) FILTER (WHERE sr.municipality IS NOT NULL) AS municipality
    FROM public.shareholder_raw sr
    INNER JOIN batch_names bn ON bn.shareholder_name = sr.shareholder_name
    GROUP BY sr.shareholder_name
  ),
  company_detail AS (
    SELECT
      sr.shareholder_name,
      sr.orgnr,
      MODE() WITHIN GROUP (ORDER BY sr.company_name) AS company_name,
      SUM(COALESCE(sr.shares, 0))::double precision AS shares
    FROM public.shareholder_raw sr
    INNER JOIN batch_names bn ON bn.shareholder_name = sr.shareholder_name
    WHERE sr.orgnr IS NOT NULL
      AND sr.orgnr <> ''
    GROUP BY sr.shareholder_name, sr.orgnr
  ),
  company_rollup AS (
    SELECT
      cd.shareholder_name,
      COUNT(*)::integer AS portfolio_size,
      COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'orgnr', cd.orgnr,
            'company_name', cd.company_name,
            'shares', cd.shares
          )
          ORDER BY cd.orgnr
        ),
        '[]'::jsonb
      ) AS portfolio_companies,
      COALESCE(SUM(cd.shares), 0)::double precision AS capital_estimate
    FROM company_detail cd
    GROUP BY cd.shareholder_name
  ),
  upserted AS (
    INSERT INTO public.investors (
      name, type, birth_year, gender, municipality,
      portfolio_size, portfolio_companies, capital_estimate
    )
    SELECT
      bp.shareholder_name, bp.stype, bp.birth_year, bp.gender, bp.municipality,
      COALESCE(cr.portfolio_size, 0),
      COALESCE(cr.portfolio_companies, '[]'::jsonb),
      COALESCE(cr.capital_estimate, 0)
    FROM base_profile bp
    LEFT JOIN company_rollup cr ON cr.shareholder_name = bp.shareholder_name
    ON CONFLICT (name) DO UPDATE SET
      type = EXCLUDED.type,
      birth_year = COALESCE(EXCLUDED.birth_year, investors.birth_year),
      gender = COALESCE(EXCLUDED.gender, investors.gender),
      municipality = COALESCE(EXCLUDED.municipality, investors.municipality),
      portfolio_size = EXCLUDED.portfolio_size,
      portfolio_companies = EXCLUDED.portfolio_companies,
      capital_estimate = EXCLUDED.capital_estimate,
      updated_at = now()
    RETURNING name
  )
  SELECT
    COALESCE(MAX(bn.shareholder_name), p_after_name),
    COALESCE((SELECT COUNT(*) FROM upserted), 0)
  INTO v_last_key, v_processed_count
  FROM batch_names bn;

  RETURN jsonb_build_object(
    'processed_count', v_processed_count,
    'last_key', v_last_key,
    'done', v_processed_count = 0
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.aggregate_companies(p_after_orgnr text DEFAULT NULL::text, p_limit integer DEFAULT 5000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_last_key TEXT;
  v_processed_count INT := 0;
  v_limit INT := LEAST(GREATEST(COALESCE(p_limit, 5000), 1), 10000);
BEGIN
  PERFORM set_config('statement_timeout', '240s', true);

  WITH batch_orgs AS (
    SELECT sr.orgnr
    FROM public.shareholder_raw sr
    WHERE sr.orgnr IS NOT NULL
      AND sr.orgnr <> ''
      AND (p_after_orgnr IS NULL OR sr.orgnr > p_after_orgnr)
    GROUP BY sr.orgnr
    ORDER BY sr.orgnr
    LIMIT v_limit
  ),
  company_rollup AS (
    SELECT
      sr.orgnr,
      MODE() WITHIN GROUP (ORDER BY sr.company_name) AS company_name
    FROM public.shareholder_raw sr
    INNER JOIN batch_orgs bo ON bo.orgnr = sr.orgnr
    GROUP BY sr.orgnr
  ),
  upserted AS (
    INSERT INTO public.companies (orgnr, name)
    SELECT
      cr.orgnr,
      COALESCE(NULLIF(cr.company_name, ''), cr.orgnr)
    FROM company_rollup cr
    ON CONFLICT (orgnr) DO UPDATE SET
      name = EXCLUDED.name,
      updated_at = now()
    RETURNING orgnr
  )
  SELECT
    COALESCE(MAX(bo.orgnr), p_after_orgnr),
    COALESCE((SELECT COUNT(*) FROM upserted), 0)
  INTO v_last_key, v_processed_count
  FROM batch_orgs bo;

  RETURN jsonb_build_object(
    'processed_count', v_processed_count,
    'last_key', v_last_key,
    'done', v_processed_count = 0
  );
END;
$function$;

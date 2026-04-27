
-- Unique constraints for upsert
ALTER TABLE public.investors ADD CONSTRAINT investors_name_unique UNIQUE (name);
ALTER TABLE public.companies ADD CONSTRAINT companies_orgnr_unique UNIQUE (orgnr);

-- Aggregate investors function: processes chunks of shareholder_raw into investors
CREATE OR REPLACE FUNCTION public.aggregate_investors(p_offset INT DEFAULT 0, p_limit INT DEFAULT 50000)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT := 0;
BEGIN
  INSERT INTO public.investors (name, type, birth_year, gender, municipality, portfolio_size, portfolio_companies, capital_estimate)
  SELECT
    sub.shareholder_name,
    sub.stype,
    sub.birth_year,
    sub.gender,
    sub.municipality,
    sub.portfolio_size,
    sub.portfolio_companies,
    COALESCE(sub.capital_estimate, 0)
  FROM (
    SELECT
      sr.shareholder_name,
      MODE() WITHIN GROUP (ORDER BY sr.shareholder_type) AS stype,
      MIN(sr.birth_year) FILTER (WHERE sr.birth_year IS NOT NULL) AS birth_year,
      MODE() WITHIN GROUP (ORDER BY sr.gender) FILTER (WHERE sr.gender IS NOT NULL) AS gender,
      MODE() WITHIN GROUP (ORDER BY sr.municipality) FILTER (WHERE sr.municipality IS NOT NULL) AS municipality,
      COUNT(DISTINCT sr.orgnr) AS portfolio_size,
      jsonb_agg(DISTINCT jsonb_build_object('orgnr', sr.orgnr, 'company_name', sr.company_name, 'shares', sr.shares)) AS portfolio_companies,
      SUM(COALESCE(sr.shares, 0))::double precision AS capital_estimate
    FROM public.shareholder_raw sr
    WHERE sr.shareholder_name IS NOT NULL
      AND sr.shareholder_name != '-'
      AND sr.shareholder_name != ''
    GROUP BY sr.shareholder_name
    ORDER BY sr.shareholder_name
    LIMIT p_limit OFFSET p_offset
  ) sub
  ON CONFLICT (name) DO UPDATE SET
    portfolio_size = EXCLUDED.portfolio_size,
    portfolio_companies = EXCLUDED.portfolio_companies,
    capital_estimate = EXCLUDED.capital_estimate,
    type = EXCLUDED.type,
    birth_year = COALESCE(EXCLUDED.birth_year, investors.birth_year),
    gender = COALESCE(EXCLUDED.gender, investors.gender),
    municipality = COALESCE(EXCLUDED.municipality, investors.municipality),
    updated_at = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

-- Aggregate companies function
CREATE OR REPLACE FUNCTION public.aggregate_companies(p_offset INT DEFAULT 0, p_limit INT DEFAULT 50000)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INT := 0;
BEGIN
  INSERT INTO public.companies (orgnr, name)
  SELECT
    sub.orgnr,
    sub.company_name
  FROM (
    SELECT
      sr.orgnr,
      MODE() WITHIN GROUP (ORDER BY sr.company_name) AS company_name
    FROM public.shareholder_raw sr
    WHERE sr.orgnr IS NOT NULL AND sr.orgnr != ''
    GROUP BY sr.orgnr
    ORDER BY sr.orgnr
    LIMIT p_limit OFFSET p_offset
  ) sub
  ON CONFLICT (orgnr) DO UPDATE SET
    name = EXCLUDED.name,
    updated_at = now();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

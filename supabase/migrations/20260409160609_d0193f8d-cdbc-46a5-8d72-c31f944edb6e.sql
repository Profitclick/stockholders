
-- 1. Add as_of_year to shareholder_raw (nullable, backfill from year column)
ALTER TABLE public.shareholder_raw ADD COLUMN IF NOT EXISTS as_of_year integer;

-- Backfill as_of_year from existing year column where reasonable
UPDATE public.shareholder_raw SET as_of_year = year WHERE as_of_year IS NULL AND year BETWEEN 2020 AND 2026;

-- 2. Add shareholder/investor counts to companies
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS shareholder_count integer DEFAULT 0;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS investor_count integer DEFAULT 0;

-- 3. Create investor_triggers table
CREATE TABLE IF NOT EXISTS public.investor_triggers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_id uuid REFERENCES public.investors(id) ON DELETE CASCADE,
  trigger_type text NOT NULL,
  orgnr text,
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.investor_triggers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read triggers" ON public.investor_triggers FOR SELECT USING (true);
CREATE POLICY "Public write triggers" ON public.investor_triggers FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update triggers" ON public.investor_triggers FOR UPDATE USING (true);
CREATE POLICY "Public delete triggers" ON public.investor_triggers FOR DELETE USING (true);

CREATE INDEX IF NOT EXISTS idx_investor_triggers_investor_id ON public.investor_triggers(investor_id);
CREATE INDEX IF NOT EXISTS idx_investor_triggers_type ON public.investor_triggers(trigger_type);

-- 4. Index for as_of_year queries
CREATE INDEX IF NOT EXISTS idx_shareholder_raw_as_of_year ON public.shareholder_raw(as_of_year);

-- 5. Replace aggregate_companies to include counts
CREATE OR REPLACE FUNCTION public.aggregate_companies(p_after_orgnr text DEFAULT NULL, p_limit integer DEFAULT 2000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_last_key TEXT;
  v_processed_count INT := 0;
  v_limit INT := LEAST(GREATEST(COALESCE(p_limit, 2000), 1), 5000);
  v_orgnrs TEXT[];
BEGIN
  PERFORM set_config('statement_timeout', '240s', true);

  SELECT array_agg(o) INTO v_orgnrs
  FROM (
    SELECT DISTINCT sr.orgnr AS o
    FROM public.shareholder_raw sr
    WHERE sr.orgnr IS NOT NULL AND sr.orgnr <> ''
      AND (p_after_orgnr IS NULL OR sr.orgnr > p_after_orgnr)
    ORDER BY sr.orgnr
    LIMIT v_limit
  ) sub;

  IF v_orgnrs IS NULL OR array_length(v_orgnrs, 1) IS NULL THEN
    RETURN jsonb_build_object('processed_count', 0, 'last_key', p_after_orgnr, 'done', true);
  END IF;

  v_last_key := v_orgnrs[array_length(v_orgnrs, 1)];

  WITH company_rollup AS (
    SELECT
      sr.orgnr,
      MODE() WITHIN GROUP (ORDER BY sr.company_name) AS company_name,
      COUNT(DISTINCT sr.shareholder_name) FILTER (WHERE sr.shareholder_name IS NOT NULL AND sr.shareholder_name <> '') AS shareholder_count,
      COUNT(DISTINCT sr.shareholder_name) FILTER (WHERE sr.shareholder_type IN ('PERSON','person')) AS investor_count
    FROM public.shareholder_raw sr
    WHERE sr.orgnr = ANY(v_orgnrs)
    GROUP BY sr.orgnr
  ),
  upserted AS (
    INSERT INTO public.companies (orgnr, name, shareholder_count, investor_count)
    SELECT
      cr.orgnr,
      COALESCE(NULLIF(cr.company_name, ''), cr.orgnr),
      cr.shareholder_count,
      cr.investor_count
    FROM company_rollup cr
    ON CONFLICT (orgnr) DO UPDATE SET
      name = COALESCE(NULLIF(EXCLUDED.name, companies.orgnr), companies.name),
      shareholder_count = EXCLUDED.shareholder_count,
      investor_count = EXCLUDED.investor_count,
      updated_at = now()
    RETURNING orgnr
  )
  SELECT COUNT(*) INTO v_processed_count FROM upserted;

  RETURN jsonb_build_object(
    'processed_count', v_processed_count,
    'last_key', v_last_key,
    'done', false
  );
END;
$function$;

-- 6. Trigger detection function: compares 2022 vs 2023 shareholder data
CREATE OR REPLACE FUNCTION public.detect_yoy_triggers(p_limit integer DEFAULT 5000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout TO '240s'
SET search_path TO 'public'
AS $function$
DECLARE
  v_portfolio_growth INT := 0;
  v_majority_change INT := 0;
  v_capital_increase INT := 0;
BEGIN
  -- Portfolio growth > 20%
  WITH yr AS (
    SELECT
      shareholder_name,
      COUNT(DISTINCT orgnr) FILTER (WHERE as_of_year = 2022) AS cnt_2022,
      COUNT(DISTINCT orgnr) FILTER (WHERE as_of_year = 2023) AS cnt_2023
    FROM public.shareholder_raw
    WHERE shareholder_name IS NOT NULL AND shareholder_name <> '' AND shareholder_name <> '-'
      AND as_of_year IN (2022, 2023)
    GROUP BY shareholder_name
    HAVING COUNT(DISTINCT orgnr) FILTER (WHERE as_of_year = 2022) > 0
    LIMIT p_limit
  ),
  growth AS (
    SELECT yr.shareholder_name, yr.cnt_2022, yr.cnt_2023,
      (yr.cnt_2023::numeric - yr.cnt_2022) / GREATEST(yr.cnt_2022, 1) AS pct
    FROM yr
    WHERE yr.cnt_2023 > yr.cnt_2022
      AND (yr.cnt_2023::numeric - yr.cnt_2022) / GREATEST(yr.cnt_2022, 1) > 0.2
  ),
  inserted AS (
    INSERT INTO public.investor_triggers (investor_id, trigger_type, metadata)
    SELECT i.id, 'portfolio_growth',
      jsonb_build_object('growth_pct', ROUND(g.pct::numeric * 100, 1), 'from', g.cnt_2022, 'to', g.cnt_2023)
    FROM growth g
    INNER JOIN public.investors i ON i.name = g.shareholder_name
    ON CONFLICT DO NOTHING
    RETURNING id
  )
  SELECT COUNT(*) INTO v_portfolio_growth FROM inserted;

  -- Majority ownership changes
  WITH shares_by_year AS (
    SELECT orgnr, shareholder_name, as_of_year,
      SUM(shares) AS total_shares
    FROM public.shareholder_raw
    WHERE as_of_year IN (2022, 2023) AND shares > 0
    GROUP BY orgnr, shareholder_name, as_of_year
  ),
  top_holders AS (
    SELECT orgnr, as_of_year, shareholder_name,
      ROW_NUMBER() OVER (PARTITION BY orgnr, as_of_year ORDER BY total_shares DESC) AS rn
    FROM shares_by_year
  ),
  changes AS (
    SELECT t23.orgnr, t23.shareholder_name AS new_majority, t22.shareholder_name AS old_majority
    FROM top_holders t23
    LEFT JOIN top_holders t22 ON t22.orgnr = t23.orgnr AND t22.as_of_year = 2022 AND t22.rn = 1
    WHERE t23.as_of_year = 2023 AND t23.rn = 1
      AND (t22.shareholder_name IS NULL OR t22.shareholder_name <> t23.shareholder_name)
    LIMIT p_limit
  ),
  ins_maj AS (
    INSERT INTO public.investor_triggers (investor_id, trigger_type, orgnr, metadata)
    SELECT i.id, 'ownership:majority_change', c.orgnr,
      jsonb_build_object('new_majority', c.new_majority, 'old_majority', c.old_majority)
    FROM changes c
    INNER JOIN public.investors i ON i.name = c.new_majority
    ON CONFLICT DO NOTHING
    RETURNING id
  )
  SELECT COUNT(*) INTO v_majority_change FROM ins_maj;

  -- Capital increase (total shares increased > 20%)
  WITH cap AS (
    SELECT shareholder_name,
      SUM(shares) FILTER (WHERE as_of_year = 2022) AS cap_2022,
      SUM(shares) FILTER (WHERE as_of_year = 2023) AS cap_2023
    FROM public.shareholder_raw
    WHERE shareholder_name IS NOT NULL AND shareholder_name <> '' AND as_of_year IN (2022, 2023)
    GROUP BY shareholder_name
    HAVING SUM(shares) FILTER (WHERE as_of_year = 2022) > 0
    LIMIT p_limit
  ),
  cap_inc AS (
    SELECT shareholder_name, cap_2022, cap_2023,
      (cap_2023::numeric - cap_2022) / GREATEST(cap_2022, 1) AS pct
    FROM cap
    WHERE cap_2023 > cap_2022
      AND (cap_2023::numeric - cap_2022) / GREATEST(cap_2022, 1) > 0.2
  ),
  ins_cap AS (
    INSERT INTO public.investor_triggers (investor_id, trigger_type, metadata)
    SELECT i.id, 'ownership:capital_increase',
      jsonb_build_object('increase_pct', ROUND(ci.pct::numeric * 100, 1), 'from', ci.cap_2022, 'to', ci.cap_2023)
    FROM cap_inc ci
    INNER JOIN public.investors i ON i.name = ci.shareholder_name
    ON CONFLICT DO NOTHING
    RETURNING id
  )
  SELECT COUNT(*) INTO v_capital_increase FROM ins_cap;

  RETURN jsonb_build_object(
    'portfolio_growth_triggers', v_portfolio_growth,
    'majority_change_triggers', v_majority_change,
    'capital_increase_triggers', v_capital_increase
  );
END;
$function$;

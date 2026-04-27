
-- Bulk scoring function — processes all investors in SQL, no edge function needed
CREATE OR REPLACE FUNCTION public.bulk_score_investors(
  p_weights jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout TO '300s'
SET search_path TO 'public'
AS $$
DECLARE
  v_scored INT := 0;
  v_w_portfolio_size NUMERIC := COALESCE((p_weights->>'portfolio_size')::numeric, 25);
  v_w_yoy_changes NUMERIC := COALESCE((p_weights->>'yoy_changes')::numeric, 20);
  v_w_entity_type NUMERIC := COALESCE((p_weights->>'entity_type')::numeric, 15);
  v_w_industry NUMERIC := COALESCE((p_weights->>'industry_exposure')::numeric, 15);
  v_w_capital NUMERIC := COALESCE((p_weights->>'capital_estimate')::numeric, 15);
  v_w_ownership NUMERIC := COALESCE((p_weights->>'ownership_concentration')::numeric, 10);
  v_total_weight NUMERIC;
BEGIN
  v_total_weight := v_w_portfolio_size + v_w_yoy_changes + v_w_entity_type + v_w_industry + v_w_capital + v_w_ownership;
  IF v_total_weight = 0 THEN v_total_weight := 100; END IF;

  WITH scored AS (
    UPDATE public.investors i SET
      ias_score = ROUND((
        -- Portfolio size score (log scale 0-100)
        (LEAST(100, CASE WHEN i.portfolio_size <= 0 THEN 0 ELSE (log(i.portfolio_size + 1) / log(51)) * 100 END) * v_w_portfolio_size) +
        -- YoY changes score
        (LEAST(100, COALESCE(jsonb_object_keys_count(i.yoy_changes), 0) * 20) * v_w_yoy_changes) +
        -- Entity type score
        (CASE i.type
          WHEN 'ASA' THEN 90 WHEN 'AS' THEN 80 WHEN 'COMPANY' THEN 75
          WHEN 'NUF' THEN 60 WHEN 'ANS' THEN 55 WHEN 'DA' THEN 55
          WHEN 'PERSON' THEN 50 WHEN 'person' THEN 50
          WHEN 'FOREIGNER' THEN 45 WHEN 'ENK' THEN 40
          ELSE 30
        END * v_w_entity_type) +
        -- Industry score
        (LEAST(100, COALESCE(jsonb_array_length(i.portfolio_industries), 0) * 15) * v_w_industry) +
        -- Capital score (log scale)
        (CASE WHEN COALESCE(i.capital_estimate, 0) <= 0 THEN 0 ELSE LEAST(100, (log(i.capital_estimate + 1) / log(10000001)) * 100) END * v_w_capital) +
        -- Ownership score
        (LEAST(100, (
          CASE WHEN (i.brreg_context->>'ownership_change_pct')::numeric IS NOT NULL AND ABS((i.brreg_context->>'ownership_change_pct')::numeric) > 20 THEN 25 ELSE 0 END +
          CASE WHEN (i.brreg_context->>'is_majority_owner')::boolean THEN 50 ELSE 0 END +
          CASE WHEN (i.brreg_context->>'has_complete_ownership_structure')::boolean THEN 15 ELSE 0 END
        )) * v_w_ownership)
      ) / v_total_weight, 1)::double precision,
      -- Risk score
      risk_score = ROUND((
        LEAST(100, CASE WHEN COALESCE(jsonb_array_length(i.portfolio_industries), 0) > 0 THEN 100 - COALESCE(jsonb_array_length(i.portfolio_industries), 0) * 10 ELSE 50 END) * 0.5 +
        LEAST(100, COALESCE(jsonb_object_keys_count(i.yoy_changes), 0) * 10) * 0.5
      ), 1)::double precision,
      -- Sector score
      sector_score = ROUND(LEAST(100, COALESCE(jsonb_array_length(i.portfolio_industries), 0) * 15), 1)::double precision,
      -- Capital score
      capital_score = ROUND(CASE WHEN COALESCE(i.capital_estimate, 0) <= 0 THEN 0 ELSE LEAST(100, (log(i.capital_estimate + 1) / log(10000001)) * 100) END, 1)::double precision,
      -- Velocity score
      velocity_score = ROUND(CASE
        WHEN COALESCE(jsonb_object_keys_count(i.yoy_changes), 0) >= 2 THEN LEAST(100, COALESCE(jsonb_object_keys_count(i.yoy_changes), 0) * 15)
        ELSE COALESCE(jsonb_object_keys_count(i.yoy_changes), 0) * 25
      END, 1)::double precision,
      custom_scores = jsonb_set(COALESCE(i.custom_scores, '{}'::jsonb), '{computed_at}', to_jsonb(now()::text)),
      updated_at = now()
    RETURNING i.id
  )
  SELECT count(*) INTO v_scored FROM scored;

  RETURN jsonb_build_object('scored', v_scored);
END;
$$;

-- Helper: count jsonb object keys
CREATE OR REPLACE FUNCTION public.jsonb_object_keys_count(j jsonb)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN j IS NULL OR jsonb_typeof(j) != 'object' THEN 0
    ELSE (SELECT count(*)::integer FROM jsonb_object_keys(j))
  END;
$$;

-- Stats cache table for lightweight dashboard loading
CREATE TABLE IF NOT EXISTS public.pipeline_stats (
  key TEXT PRIMARY KEY,
  value BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.pipeline_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read stats" ON public.pipeline_stats FOR SELECT USING (true);
CREATE POLICY "Public write stats" ON public.pipeline_stats FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update stats" ON public.pipeline_stats FOR UPDATE USING (true);

-- Function to refresh cached stats
CREATE OR REPLACE FUNCTION public.refresh_pipeline_stats()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout TO '60s'
SET search_path TO 'public'
AS $$
DECLARE
  v_investors BIGINT;
  v_companies BIGINT;
  v_raw BIGINT;
  v_enriched BIGINT;
  v_scored BIGINT;
BEGIN
  SELECT count(*) INTO v_investors FROM public.investors;
  SELECT count(*) INTO v_companies FROM public.companies;
  SELECT count(*) INTO v_raw FROM public.shareholder_raw;
  SELECT count(*) INTO v_enriched FROM public.companies WHERE enriched = true;
  SELECT count(*) INTO v_scored FROM public.investors WHERE ias_score > 0;

  INSERT INTO public.pipeline_stats (key, value, updated_at) VALUES
    ('investors', v_investors, now()),
    ('companies', v_companies, now()),
    ('shareholder_raw', v_raw, now()),
    ('enriched_companies', v_enriched, now()),
    ('scored_investors', v_scored, now())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
END;
$$;

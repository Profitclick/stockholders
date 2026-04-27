
-- Phase 2: Add orgnr column to plugin_data
ALTER TABLE public.plugin_data ADD COLUMN IF NOT EXISTS orgnr text;
CREATE INDEX IF NOT EXISTS idx_plugin_data_orgnr ON public.plugin_data(orgnr);

-- Cross-reference function
CREATE OR REPLACE FUNCTION public.cross_reference_plugin(p_plugin_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_total INT;
  v_matched INT;
  v_rate TEXT;
BEGIN
  SELECT count(*) INTO v_total FROM public.plugin_data WHERE plugin_id = p_plugin_id AND orgnr IS NOT NULL AND orgnr <> '';
  
  SELECT count(DISTINCT pd.orgnr) INTO v_matched
  FROM public.plugin_data pd
  INNER JOIN public.companies c ON c.orgnr = pd.orgnr
  WHERE pd.plugin_id = p_plugin_id AND pd.orgnr IS NOT NULL AND pd.orgnr <> '';

  v_rate := CASE WHEN v_total > 0 THEN ROUND((v_matched::numeric / v_total) * 100, 1)::text || '%' ELSE '0%' END;

  UPDATE public.plugins SET config = jsonb_set(
    jsonb_set(COALESCE(config, '{}'::jsonb), '{matched_companies}', to_jsonb(v_matched)),
    '{match_rate}', to_jsonb(v_rate)
  )
  WHERE id = p_plugin_id;

  RETURN jsonb_build_object('total_with_orgnr', v_total, 'matched', v_matched, 'match_rate', v_rate);
END;
$$;

-- Lookalike segment function
CREATE OR REPLACE FUNCTION public.generate_lookalike_segment(p_seed_profile jsonb, p_limit int DEFAULT 500)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout TO '120s'
SET search_path TO 'public'
AS $$
DECLARE
  v_segment_id UUID;
  v_investor_ids JSONB;
  v_count INT;
  v_avg_sim NUMERIC;
  v_seed_industries JSONB := COALESCE(p_seed_profile->'industries', '[]'::jsonb);
  v_seed_municipalities JSONB := COALESCE(p_seed_profile->'municipalities', '[]'::jsonb);
  v_seed_types JSONB := COALESCE(p_seed_profile->'entity_types', '[]'::jsonb);
  v_seed_min_ps INT := COALESCE((p_seed_profile->>'min_portfolio_size')::int, 0);
  v_seed_max_ps INT := COALESCE((p_seed_profile->>'max_portfolio_size')::int, 1000);
  v_seed_min_cap DOUBLE PRECISION := COALESCE((p_seed_profile->>'min_capital')::double precision, 0);
  v_seed_max_cap DOUBLE PRECISION := COALESCE((p_seed_profile->>'max_capital')::double precision, 999999999);
BEGIN
  WITH scored AS (
    SELECT
      i.id,
      (
        CASE WHEN v_seed_municipalities = '[]'::jsonb THEN 0
             WHEN i.municipality IS NOT NULL AND v_seed_municipalities ? i.municipality THEN 30
             ELSE 0 END +
        CASE WHEN v_seed_types = '[]'::jsonb THEN 0
             WHEN i.type IS NOT NULL AND v_seed_types ? i.type THEN 20
             ELSE 0 END +
        CASE WHEN i.portfolio_size BETWEEN v_seed_min_ps AND v_seed_max_ps THEN 20 ELSE 0 END +
        CASE WHEN COALESCE(i.capital_estimate, 0) BETWEEN v_seed_min_cap AND v_seed_max_cap THEN 15 ELSE 0 END +
        CASE WHEN v_seed_industries = '[]'::jsonb THEN 0
             WHEN i.portfolio_industries IS NOT NULL AND jsonb_array_length(i.portfolio_industries) > 0
               AND EXISTS (
                 SELECT 1 FROM jsonb_array_elements_text(i.portfolio_industries) pi
                 WHERE v_seed_industries ? pi
               ) THEN 15
             ELSE 0 END
      ) AS similarity
    FROM public.investors i
    WHERE i.ias_score > 0
  )
  SELECT jsonb_agg(sub.id), count(*), ROUND(AVG(sub.similarity)::numeric, 1)
  INTO v_investor_ids, v_count, v_avg_sim
  FROM (SELECT id, similarity FROM scored WHERE similarity >= 20 ORDER BY similarity DESC LIMIT p_limit) sub;

  v_segment_id := gen_random_uuid();

  INSERT INTO public.segments (id, investor_ids, summary)
  VALUES (v_segment_id, v_investor_ids, jsonb_build_object(
    'type', 'lookalike',
    'total_investors', v_count,
    'avg_similarity', v_avg_sim,
    'seed_profile', p_seed_profile,
    'profile_name', COALESCE(p_seed_profile->>'name', 'Lookalike Segment')
  ));

  RETURN jsonb_build_object('segment_id', v_segment_id, 'matched', v_count, 'avg_similarity', v_avg_sim);
END;
$$;

-- Updated bulk_score_investors with plugin bonus
CREATE OR REPLACE FUNCTION public.bulk_score_investors(p_weights jsonb DEFAULT NULL::jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout TO '120s'
SET search_path TO 'public'
AS $$
DECLARE
  v_scored INT := 0;
  v_w_ps NUMERIC := COALESCE((p_weights->>'portfolio_size')::numeric, 25);
  v_w_yoy NUMERIC := COALESCE((p_weights->>'yoy_changes')::numeric, 20);
  v_w_et NUMERIC := COALESCE((p_weights->>'entity_type')::numeric, 15);
  v_w_ind NUMERIC := COALESCE((p_weights->>'industry_exposure')::numeric, 15);
  v_w_cap NUMERIC := COALESCE((p_weights->>'capital_estimate')::numeric, 15);
  v_w_own NUMERIC := COALESCE((p_weights->>'ownership_concentration')::numeric, 10);
  v_tw NUMERIC;
  v_after UUID := COALESCE((p_weights->>'_after_id')::uuid, '00000000-0000-0000-0000-000000000000'::uuid);
  v_batch_size INT := COALESCE((p_weights->>'_batch_size')::int, 25000);
  v_ids UUID[];
  v_last_id UUID;
BEGIN
  v_tw := v_w_ps + v_w_yoy + v_w_et + v_w_ind + v_w_cap + v_w_own;
  IF v_tw = 0 THEN v_tw := 100; END IF;

  SELECT array_agg(id) INTO v_ids
  FROM (
    SELECT id FROM public.investors
    WHERE id > v_after
    ORDER BY id
    LIMIT v_batch_size
  ) sub;

  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('scored', 0, 'done', true);
  END IF;

  v_last_id := v_ids[array_length(v_ids, 1)];

  WITH plugin_bonuses AS (
    SELECT
      i.id AS investor_id,
      LEAST(20, COALESCE(SUM(
        CASE
          WHEN p.dataset_type = 'skattefunn' THEN 5
          WHEN p.dataset_type = 'eu_grants' THEN 8
          WHEN p.dataset_type IN ('grants', 'research_council') THEN 3
          ELSE 0
        END
      ), 0))::numeric AS bonus
    FROM public.investors i
    LEFT JOIN LATERAL (
      SELECT pd.plugin_id FROM public.plugin_data pd
      INNER JOIN jsonb_array_elements(i.portfolio_companies) pc ON true
      WHERE pd.orgnr = pc->>'orgnr' AND pd.orgnr IS NOT NULL
      LIMIT 10
    ) matched ON true
    LEFT JOIN public.plugins p ON p.id = matched.plugin_id AND p.enabled = true
    WHERE i.id = ANY(v_ids)
    GROUP BY i.id
  ),
  scored AS (
    UPDATE public.investors i SET
      ias_score = ROUND((
        (LEAST(100.0, CASE WHEN i.portfolio_size <= 0 THEN 0.0 ELSE (ln(i.portfolio_size + 1) / ln(51)) * 100.0 END) * v_w_ps) +
        (LEAST(100.0, COALESCE(jsonb_object_keys_count(i.yoy_changes), 0) * 20.0) * v_w_yoy) +
        (CASE COALESCE(i.type, '')
          WHEN 'ASA' THEN 90 WHEN 'AS' THEN 80 WHEN 'COMPANY' THEN 75
          WHEN 'NUF' THEN 60 WHEN 'ANS' THEN 55 WHEN 'DA' THEN 55
          WHEN 'PERSON' THEN 50 WHEN 'person' THEN 50
          WHEN 'FOREIGNER' THEN 45 WHEN 'ENK' THEN 40
          ELSE 30
        END * v_w_et) +
        (LEAST(100.0, COALESCE(jsonb_array_length(i.portfolio_industries), 0) * 15.0) * v_w_ind) +
        (CASE WHEN COALESCE(i.capital_estimate, 0) <= 0 THEN 0.0
          ELSE LEAST(100.0, (ln(i.capital_estimate + 1) / ln(10000001)) * 100.0)
        END * v_w_cap) +
        (LEAST(100.0, (
          CASE WHEN (i.brreg_context->>'ownership_change_pct') IS NOT NULL AND ABS((i.brreg_context->>'ownership_change_pct')::numeric) > 20 THEN 25.0 ELSE 0.0 END +
          CASE WHEN (i.brreg_context->>'is_majority_owner')::text = 'true' THEN 50.0 ELSE 0.0 END +
          CASE WHEN (i.brreg_context->>'has_complete_ownership_structure')::text = 'true' THEN 15.0 ELSE 0.0 END
        )) * v_w_own)
      )::numeric / v_tw + COALESCE(pb.bonus, 0), 1)::double precision,
      risk_score = ROUND((
        LEAST(100.0, CASE WHEN COALESCE(jsonb_array_length(i.portfolio_industries), 0) > 0 THEN GREATEST(0.0, 100.0 - COALESCE(jsonb_array_length(i.portfolio_industries), 0) * 10.0) ELSE 50.0 END) * 0.5 +
        LEAST(100.0, COALESCE(jsonb_object_keys_count(i.yoy_changes), 0) * 10.0) * 0.5
      )::numeric, 1)::double precision,
      sector_score = ROUND(LEAST(100.0, COALESCE(jsonb_array_length(i.portfolio_industries), 0) * 15.0)::numeric, 1)::double precision,
      capital_score = ROUND((CASE WHEN COALESCE(i.capital_estimate, 0) <= 0 THEN 0.0 ELSE LEAST(100.0, (ln(i.capital_estimate + 1) / ln(10000001)) * 100.0) END)::numeric, 1)::double precision,
      velocity_score = ROUND((CASE
        WHEN COALESCE(jsonb_object_keys_count(i.yoy_changes), 0) >= 2 THEN LEAST(100.0, COALESCE(jsonb_object_keys_count(i.yoy_changes), 0) * 15.0)
        ELSE COALESCE(jsonb_object_keys_count(i.yoy_changes), 0) * 25.0
      END)::numeric, 1)::double precision,
      custom_scores = jsonb_set(COALESCE(i.custom_scores, '{}'::jsonb), '{computed_at}', to_jsonb(now()::text)),
      updated_at = now()
    FROM plugin_bonuses pb
    WHERE i.id = pb.investor_id
    RETURNING i.id
  )
  SELECT count(*) INTO v_scored FROM scored;

  RETURN jsonb_build_object('scored', v_scored, 'last_id', v_last_id, 'done', false);
END;
$$;

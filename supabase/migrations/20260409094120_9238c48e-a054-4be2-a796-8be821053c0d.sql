
CREATE OR REPLACE FUNCTION public.bulk_score_investors(p_weights jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET statement_timeout TO '300s'
 SET search_path TO 'public'
AS $function$
DECLARE
  v_scored INT := 0;
  v_w_ps NUMERIC := COALESCE((p_weights->>'portfolio_size')::numeric, 25);
  v_w_yoy NUMERIC := COALESCE((p_weights->>'yoy_changes')::numeric, 20);
  v_w_et NUMERIC := COALESCE((p_weights->>'entity_type')::numeric, 15);
  v_w_ind NUMERIC := COALESCE((p_weights->>'industry_exposure')::numeric, 15);
  v_w_cap NUMERIC := COALESCE((p_weights->>'capital_estimate')::numeric, 15);
  v_w_own NUMERIC := COALESCE((p_weights->>'ownership_concentration')::numeric, 10);
  v_tw NUMERIC;
BEGIN
  v_tw := v_w_ps + v_w_yoy + v_w_et + v_w_ind + v_w_cap + v_w_own;
  IF v_tw = 0 THEN v_tw := 100; END IF;

  WITH scored AS (
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
      )::numeric / v_tw, 1)::double precision,
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
    WHERE i.id IS NOT NULL
    RETURNING i.id
  )
  SELECT count(*) INTO v_scored FROM scored;

  RETURN jsonb_build_object('scored', v_scored);
END;
$function$;

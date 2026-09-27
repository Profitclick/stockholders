CREATE OR REPLACE FUNCTION public.refresh_company_signals()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows integer;
BEGIN
  -- Resolve Doffin winners against registered company names once per refresh
  UPDATE contract_awards ca
  SET matched_orgnr = c.orgnr
  FROM (
    SELECT DISTINCT ON (normalize_company_name(name)) normalize_company_name(name) AS nn, orgnr
    FROM companies
    WHERE normalize_company_name(name) IS NOT NULL
  ) c
  WHERE ca.matched_orgnr IS NULL
    AND ca.awarded_name_norm = c.nn;

  WITH trig AS (
    SELECT orgnr,
           count(*) AS trigger_count,
           bool_or(trigger_type = 'ownership:majority_change')  AS maj,
           bool_or(trigger_type = 'ownership:new_shareholder')  AS newsh,
           bool_or(trigger_type = 'ownership:capital_increase') AS cap
    FROM investor_triggers
    WHERE orgnr IS NOT NULL
    GROUP BY orgnr
  ),
  plug AS (
    SELECT pd.orgnr,
           count(*) FILTER (WHERE p.dataset_type = 'skattefunn')        AS skattefunn_count,
           count(*) FILTER (WHERE p.dataset_type = 'grants')            AS grants_count,
           count(*) FILTER (WHERE p.dataset_type = 'eu_grants')         AS eu_grants_count,
           count(*) FILTER (WHERE p.dataset_type = 'research_council')  AS research_council_count,
           count(*) FILTER (WHERE p.dataset_type = 'ip_rights')         AS ip_rights_count,
           count(*) FILTER (WHERE p.dataset_type = 'jobs')              AS open_jobs_count
    FROM plugin_data pd
    JOIN plugins p ON p.id = pd.plugin_id
    WHERE pd.orgnr IS NOT NULL
    GROUP BY pd.orgnr
  ),
  awards AS (
    SELECT matched_orgnr AS orgnr,
           count(*) AS contract_count,
           coalesce(sum(estimated_value), 0) AS contract_value
    FROM contract_awards
    WHERE matched_orgnr IS NOT NULL
    GROUP BY matched_orgnr
  ),
  src AS (
    SELECT
      c.orgnr,
      c.name,
      c.industry,
      c.email, c.phone, c.website,
      nullif(c.brreg_data->>'nace_code', '') AS nace_code,
      left(nullif(c.brreg_data->>'nace_code', ''), 2) AS nace_prefix,
      nullif(c.brreg_data->>'organisasjonsform', '') AS org_form,
      nullif(c.brreg_data->'forretningsadresse'->>'kommune', '') AS municipality,
      nullif(c.brreg_data->'forretningsadresse'->>'kommunenummer', '') AS municipality_no,
      nullif(c.brreg_data->'forretningsadresse'->>'postnummer', '') AS postcode,
      (nullif(c.brreg_data->>'stiftelsesdato', ''))::date AS founded_date,
      (c.brreg_data->'financials'->>'revenue')::numeric AS revenue,
      (c.brreg_data->'financials'->>'operating_profit')::numeric AS operating_profit,
      (c.brreg_data->'financials'->>'equity')::numeric AS equity,
      (c.brreg_data->'financials'->>'total_debt')::numeric AS total_debt,
      (
        SELECT r->>'name' FROM jsonb_array_elements(coalesce(c.brreg_data->'roles', '[]'::jsonb)) g,
        jsonb_array_elements(coalesce(g->'roles', '[]'::jsonb)) r
        WHERE r->>'title' = 'Daglig leder' LIMIT 1
      ) AS ceo_name,
      (
        SELECT r->>'name' FROM jsonb_array_elements(coalesce(c.brreg_data->'roles', '[]'::jsonb)) g,
        jsonb_array_elements(coalesce(g->'roles', '[]'::jsonb)) r
        WHERE r->>'title' = 'Styrets leder' LIMIT 1
      ) AS chair_name,
      (
        SELECT count(*)::int FROM jsonb_array_elements(coalesce(c.brreg_data->'roles', '[]'::jsonb)) g,
        jsonb_array_elements(coalesce(g->'roles', '[]'::jsonb)) r
        WHERE g->>'type' = 'Styre'
      ) AS board_size
    FROM companies c
  )
  INSERT INTO company_signals (
    orgnr, name, industry, nace_code, nace_prefix, org_form, municipality, municipality_no, postcode,
    founded_date, company_age_years, revenue, operating_profit, equity, total_debt, profit_margin,
    ceo_name, chair_name, board_size, email, phone, website,
    has_majority_change, has_new_shareholder, has_capital_increase, trigger_count,
    skattefunn_count, grants_count, eu_grants_count, research_council_count, ip_rights_count, open_jobs_count,
    contract_count, contract_value, lead_score, updated_at
  )
  SELECT
    s.orgnr, s.name, s.industry, s.nace_code, s.nace_prefix, s.org_form,
    s.municipality, s.municipality_no, s.postcode,
    s.founded_date,
    CASE WHEN s.founded_date IS NOT NULL
      THEN round(extract(epoch FROM (now() - s.founded_date::timestamptz)) / 31557600.0, 1) END,
    s.revenue, s.operating_profit, s.equity, s.total_debt,
    CASE WHEN coalesce(s.revenue, 0) > 0
      THEN round((coalesce(s.operating_profit, 0) / s.revenue) * 100, 1) END,
    s.ceo_name, s.chair_name, coalesce(s.board_size, 0), s.email, s.phone, s.website,
    coalesce(t.maj, false), coalesce(t.newsh, false), coalesce(t.cap, false), coalesce(t.trigger_count, 0)::int,
    coalesce(pl.skattefunn_count, 0)::int, coalesce(pl.grants_count, 0)::int, coalesce(pl.eu_grants_count, 0)::int,
    coalesce(pl.research_council_count, 0)::int, coalesce(pl.ip_rights_count, 0)::int, coalesce(pl.open_jobs_count, 0)::int,
    coalesce(aw.contract_count, 0)::int, coalesce(aw.contract_value, 0),
    least(100, greatest(0,
      15
      + CASE WHEN coalesce(t.maj, false)   THEN 25 ELSE 0 END
      + CASE WHEN coalesce(t.newsh, false) THEN 12 ELSE 0 END
      + CASE WHEN coalesce(t.cap, false)   THEN 15 ELSE 0 END
      + least(15, coalesce(pl.skattefunn_count, 0) * 10)
      + least(12, coalesce(pl.grants_count, 0) * 6)
      + least(15, coalesce(pl.eu_grants_count, 0) * 12)
      + least(10, coalesce(pl.research_council_count, 0) * 8)
      + least(8,  coalesce(pl.ip_rights_count, 0) * 4)
      + least(20, coalesce(aw.contract_count, 0) * 6)
      + CASE WHEN coalesce(s.revenue, 0) BETWEEN 5000000 AND 150000000 THEN 10
             WHEN coalesce(s.revenue, 0) > 150000000 THEN 6 ELSE 0 END
      + CASE WHEN coalesce(s.revenue, 0) > 0 AND (coalesce(s.operating_profit, 0) / s.revenue) > 0.10 THEN 6 ELSE 0 END
      + CASE WHEN s.ceo_name IS NOT NULL THEN 3 ELSE 0 END
    )),
    now()
  FROM src s
  LEFT JOIN trig t   ON t.orgnr  = s.orgnr
  LEFT JOIN plug pl  ON pl.orgnr = s.orgnr
  LEFT JOIN awards aw ON aw.orgnr = s.orgnr
  ON CONFLICT (orgnr) DO UPDATE SET
    name = EXCLUDED.name, industry = EXCLUDED.industry, nace_code = EXCLUDED.nace_code,
    nace_prefix = EXCLUDED.nace_prefix, org_form = EXCLUDED.org_form,
    municipality = EXCLUDED.municipality, municipality_no = EXCLUDED.municipality_no,
    postcode = EXCLUDED.postcode, founded_date = EXCLUDED.founded_date,
    company_age_years = EXCLUDED.company_age_years, revenue = EXCLUDED.revenue,
    operating_profit = EXCLUDED.operating_profit, equity = EXCLUDED.equity,
    total_debt = EXCLUDED.total_debt, profit_margin = EXCLUDED.profit_margin,
    ceo_name = EXCLUDED.ceo_name, chair_name = EXCLUDED.chair_name, board_size = EXCLUDED.board_size,
    email = EXCLUDED.email, phone = EXCLUDED.phone, website = EXCLUDED.website,
    has_majority_change = EXCLUDED.has_majority_change, has_new_shareholder = EXCLUDED.has_new_shareholder,
    has_capital_increase = EXCLUDED.has_capital_increase, trigger_count = EXCLUDED.trigger_count,
    skattefunn_count = EXCLUDED.skattefunn_count, grants_count = EXCLUDED.grants_count,
    eu_grants_count = EXCLUDED.eu_grants_count, research_council_count = EXCLUDED.research_council_count,
    ip_rights_count = EXCLUDED.ip_rights_count, open_jobs_count = EXCLUDED.open_jobs_count,
    contract_count = EXCLUDED.contract_count, contract_value = EXCLUDED.contract_value,
    lead_score = EXCLUDED.lead_score, updated_at = now();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN jsonb_build_object('refreshed', v_rows, 'at', now());
END;
$$;

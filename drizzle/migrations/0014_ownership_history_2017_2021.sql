ALTER TABLE public.person_ownership_history
  ADD COLUMN IF NOT EXISTS shares_2017 bigint, ADD COLUMN IF NOT EXISTS shares_2018 bigint,
  ADD COLUMN IF NOT EXISTS shares_2019 bigint, ADD COLUMN IF NOT EXISTS shares_2020 bigint,
  ADD COLUMN IF NOT EXISTS shares_2021 bigint,
  ADD COLUMN IF NOT EXISTS pct_2017 numeric, ADD COLUMN IF NOT EXISTS pct_2018 numeric,
  ADD COLUMN IF NOT EXISTS pct_2019 numeric, ADD COLUMN IF NOT EXISTS pct_2020 numeric,
  ADD COLUMN IF NOT EXISTS pct_2021 numeric;

CREATE OR REPLACE FUNCTION public.owner_history_events(p_pcts numeric[], p_shares bigint[])
 RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $function$
 SELECT coalesce(jsonb_agg(jsonb_build_object('from',y0+i-1,'to',y0+i,'kind',kind,'delta',delta) ORDER BY i,kind),'[]'::jsonb)
 FROM (SELECT 2026 - array_length(p_pcts,1) AS y0) b
 CROSS JOIN LATERAL (SELECT i,k.kind, CASE WHEN p_pcts[i] IS NOT NULL AND p_pcts[i+1] IS NOT NULL THEN p_pcts[i+1]-p_pcts[i] END AS delta
 FROM generate_series(1,array_length(p_pcts,1)-1) i CROSS JOIN LATERAL (VALUES
 ('entry',p_shares[i] IS NULL AND p_shares[i+1] IS NOT NULL),
 ('exit',p_shares[i] IS NOT NULL AND p_shares[i+1] IS NULL),
 ('majority_gain',p_pcts[i] <= 50 AND p_pcts[i+1] > 50),
 ('majority_loss',p_pcts[i] > 50 AND p_pcts[i+1] <= 50),
 ('increase',p_pcts[i+1]-p_pcts[i] >= 20),
 ('decrease',p_pcts[i+1]-p_pcts[i] <= -20)
 ) k(kind,applies) WHERE k.applies) e;
$function$;

CREATE OR REPLACE VIEW public.company_person_history WITH (security_invoker = true) AS
 SELECT id, orgnr, company, shareholder_name, birth_year, postal,
    shares_2022, shares_2023, shares_2024, shares_2025,
    pct_2022, pct_2023, pct_2024, pct_2025,
    first_year, last_year, years_present, trend, max_pct,
    owner_history_events(
      ARRAY[pct_2017,pct_2018,pct_2019,pct_2020,pct_2021,pct_2022,pct_2023,pct_2024,pct_2025],
      ARRAY[shares_2017,shares_2018,shares_2019,shares_2020,shares_2021,shares_2022,shares_2023,shares_2024,shares_2025]) AS ownership_events,
    shares_2017, shares_2018, shares_2019, shares_2020, shares_2021,
    pct_2017, pct_2018, pct_2019, pct_2020, pct_2021
 FROM public.person_ownership_history h;

CREATE OR REPLACE FUNCTION public.refresh_historical_ownership_signals()
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
 IF coalesce(auth.role(),'') <> 'service_role' AND NOT coalesce(public.has_role(auth.uid(),'admin'),false) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 PERFORM set_config('statement_timeout','600s',true);
 INSERT INTO public.historical_ownership_signals(orgnr,owner_count,entry_count,exit_count,majority_count,increase_count,decrease_count,updated_at)
 SELECT orgnr,count(DISTINCT h.id)::int,sum(entries)::int,sum(exits)::int,sum(majorities)::int,sum(increases)::int,sum(decreases)::int,now()
 FROM public.person_ownership_history h CROSS JOIN LATERAL (
 SELECT count(*) FILTER(WHERE s[i] IS NULL AND s[i+1] IS NOT NULL) entries,
 count(*) FILTER(WHERE s[i] IS NOT NULL AND s[i+1] IS NULL) exits,
 count(*) FILTER(WHERE (p[i]<=50 AND p[i+1]>50) OR (p[i]>50 AND p[i+1]<=50)) majorities,
 count(*) FILTER(WHERE p[i+1]-p[i]>=20) increases,
 count(*) FILTER(WHERE p[i+1]-p[i]<=-20) decreases
 FROM (SELECT ARRAY[h.pct_2017,h.pct_2018,h.pct_2019,h.pct_2020,h.pct_2021,h.pct_2022,h.pct_2023,h.pct_2024,h.pct_2025] p,
              ARRAY[h.shares_2017,h.shares_2018,h.shares_2019,h.shares_2020,h.shares_2021,h.shares_2022,h.shares_2023,h.shares_2024,h.shares_2025] s) a
 CROSS JOIN generate_series(1,8) i
 ) e GROUP BY orgnr
 ON CONFLICT(orgnr) DO UPDATE SET owner_count=excluded.owner_count,entry_count=excluded.entry_count,exit_count=excluded.exit_count,majority_count=excluded.majority_count,increase_count=excluded.increase_count,decrease_count=excluded.decrease_count,updated_at=excluded.updated_at;
END $function$;
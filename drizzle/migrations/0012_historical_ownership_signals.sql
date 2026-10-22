CREATE INDEX IF NOT EXISTS poh_company_page_idx ON public.person_ownership_history(orgnr,id);
CREATE OR REPLACE FUNCTION public.owner_history_events(p_pcts numeric[], p_shares bigint[])
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = public AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('from',2021+i,'to',2022+i,'kind',kind,'delta',delta) ORDER BY i,kind),'[]'::jsonb)
 FROM (SELECT i,k.kind, CASE WHEN p_pcts[i] IS NOT NULL AND p_pcts[i+1] IS NOT NULL THEN p_pcts[i+1]-p_pcts[i] END AS delta
 FROM generate_series(1,3) i CROSS JOIN LATERAL (VALUES
 ('entry',p_shares[i] IS NULL AND p_shares[i+1] IS NOT NULL),
 ('exit',p_shares[i] IS NOT NULL AND p_shares[i+1] IS NULL),
 ('majority_gain',p_pcts[i] <= 50 AND p_pcts[i+1] > 50),
 ('majority_loss',p_pcts[i] > 50 AND p_pcts[i+1] <= 50),
 ('increase',p_pcts[i+1]-p_pcts[i] >= 20),
 ('decrease',p_pcts[i+1]-p_pcts[i] <= -20)
 ) k(kind,applies) WHERE k.applies) e;
$$;
CREATE OR REPLACE VIEW public.company_person_history WITH (security_invoker=true) AS
SELECT h.*, public.owner_history_events(ARRAY[pct_2022,pct_2023,pct_2024,pct_2025], ARRAY[shares_2022,shares_2023,shares_2024,shares_2025]) AS ownership_events
FROM public.person_ownership_history h;
GRANT SELECT ON public.company_person_history TO authenticated,service_role;
CREATE TABLE public.historical_ownership_signals (
 orgnr text PRIMARY KEY, owner_count integer NOT NULL DEFAULT 0,
 entry_count integer NOT NULL DEFAULT 0, exit_count integer NOT NULL DEFAULT 0,
 majority_count integer NOT NULL DEFAULT 0, increase_count integer NOT NULL DEFAULT 0,
 decrease_count integer NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.historical_ownership_signals TO authenticated;
GRANT ALL ON public.historical_ownership_signals TO service_role;
ALTER TABLE public.historical_ownership_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin historical signals" ON public.historical_ownership_signals FOR SELECT TO authenticated USING ((SELECT public.has_role(auth.uid(),'admin')));
CREATE OR REPLACE FUNCTION public.refresh_historical_ownership_signals() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF current_user <> 'postgres' AND coalesce(auth.role(),'') <> 'service_role' AND NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 INSERT INTO public.historical_ownership_signals(orgnr,owner_count,entry_count,exit_count,majority_count,increase_count,decrease_count,updated_at)
 SELECT orgnr,count(*)::int,sum(entries)::int,sum(exits)::int,sum(majorities)::int,sum(increases)::int,sum(decreases)::int,now()
 FROM public.person_ownership_history h CROSS JOIN LATERAL (
 SELECT count(*) FILTER(WHERE s[i] IS NULL AND s[i+1] IS NOT NULL) entries,
 count(*) FILTER(WHERE s[i] IS NOT NULL AND s[i+1] IS NULL) exits,
 count(*) FILTER(WHERE (p[i]<=50 AND p[i+1]>50) OR (p[i]>50 AND p[i+1]<=50)) majorities,
 count(*) FILTER(WHERE p[i+1]-p[i]>=20) increases,
 count(*) FILTER(WHERE p[i+1]-p[i]<=-20) decreases
 FROM (SELECT ARRAY[h.pct_2022,h.pct_2023,h.pct_2024,h.pct_2025] p,ARRAY[h.shares_2022,h.shares_2023,h.shares_2024,h.shares_2025] s) a CROSS JOIN generate_series(1,3) i
 ) e GROUP BY orgnr
 ON CONFLICT(orgnr) DO UPDATE SET owner_count=excluded.owner_count,entry_count=excluded.entry_count,exit_count=excluded.exit_count,majority_count=excluded.majority_count,increase_count=excluded.increase_count,decrease_count=excluded.decrease_count,updated_at=excluded.updated_at;
END $$;
REVOKE ALL ON FUNCTION public.refresh_historical_ownership_signals() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.refresh_historical_ownership_signals() TO authenticated,service_role;
INSERT INTO public.historical_ownership_signals(orgnr,owner_count,entry_count,exit_count,majority_count,increase_count,decrease_count)
 SELECT orgnr,count(*)::int,sum(entries)::int,sum(exits)::int,sum(majorities)::int,sum(increases)::int,sum(decreases)::int
 FROM public.person_ownership_history h CROSS JOIN LATERAL (
 SELECT count(*) FILTER(WHERE s[i] IS NULL AND s[i+1] IS NOT NULL) entries,
 count(*) FILTER(WHERE s[i] IS NOT NULL AND s[i+1] IS NULL) exits,
 count(*) FILTER(WHERE (p[i]<=50 AND p[i+1]>50) OR (p[i]>50 AND p[i+1]<=50)) majorities,
 count(*) FILTER(WHERE p[i+1]-p[i]>=20) increases,
 count(*) FILTER(WHERE p[i+1]-p[i]<=-20) decreases
 FROM (SELECT ARRAY[h.pct_2022,h.pct_2023,h.pct_2024,h.pct_2025] p,ARRAY[h.shares_2022,h.shares_2023,h.shares_2024,h.shares_2025] s) a CROSS JOIN generate_series(1,3) i
 ) e GROUP BY orgnr;
CREATE OR REPLACE VIEW public.historical_playbook_candidates WITH (security_invoker=true) AS
 SELECT s.*, h.owner_count,h.entry_count,h.exit_count,h.majority_count,h.increase_count,h.decrease_count
 FROM public.company_signals s JOIN public.historical_ownership_signals h USING(orgnr);
GRANT SELECT ON public.historical_playbook_candidates TO authenticated,service_role;
COMMENT ON TABLE public.historical_ownership_signals IS 'Observed person register changes across 2022-2025; not proof of trades, capital increases or nominee beneficial ownership. Refresh after offline history loads.';
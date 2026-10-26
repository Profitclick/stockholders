CREATE OR REPLACE FUNCTION public.refresh_historical_ownership_signals_range(p_from text, p_to text)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v int;
BEGIN
 IF coalesce(auth.role(),'') <> 'service_role' AND NOT coalesce(public.has_role(auth.uid(),'admin'),false) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE='42501'; END IF;
 INSERT INTO public.historical_ownership_signals(orgnr,owner_count,entry_count,exit_count,majority_count,increase_count,decrease_count,updated_at)
 SELECT orgnr,count(*)::int,sum(entries)::int,sum(exits)::int,sum(majorities)::int,sum(increases)::int,sum(decreases)::int,now()
 FROM public.person_ownership_history h CROSS JOIN LATERAL (
 SELECT count(*) FILTER(WHERE s[i] IS NULL AND s[i+1] IS NOT NULL) entries,
 count(*) FILTER(WHERE s[i] IS NOT NULL AND s[i+1] IS NULL) exits,
 count(*) FILTER(WHERE (p[i]<=50 AND p[i+1]>50) OR (p[i]>50 AND p[i+1]<=50)) majorities,
 count(*) FILTER(WHERE p[i+1]-p[i]>=20) increases,
 count(*) FILTER(WHERE p[i+1]-p[i]<=-20) decreases
 FROM (SELECT ARRAY[h.pct_2017,h.pct_2018,h.pct_2019,h.pct_2020,h.pct_2021,h.pct_2022,h.pct_2023,h.pct_2024,h.pct_2025] p,
              ARRAY[h.shares_2017,h.shares_2018,h.shares_2019,h.shares_2020,h.shares_2021,h.shares_2022,h.shares_2023,h.shares_2024,h.shares_2025] s) a
 CROSS JOIN generate_series(1,8) i
 ) e WHERE h.orgnr >= p_from AND h.orgnr < p_to GROUP BY orgnr
 ON CONFLICT(orgnr) DO UPDATE SET owner_count=excluded.owner_count,entry_count=excluded.entry_count,exit_count=excluded.exit_count,majority_count=excluded.majority_count,increase_count=excluded.increase_count,decrease_count=excluded.decrease_count,updated_at=excluded.updated_at;
 GET DIAGNOSTICS v = ROW_COUNT;
 RETURN v;
END $function$;
REVOKE ALL ON FUNCTION public.refresh_historical_ownership_signals_range(text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.refresh_historical_ownership_signals_range(text,text) TO authenticated, service_role;
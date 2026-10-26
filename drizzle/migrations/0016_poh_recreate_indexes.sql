SET statement_timeout = 0;
CREATE INDEX IF NOT EXISTS poh_company_page_idx ON public.person_ownership_history (orgnr, id);
CREATE INDEX IF NOT EXISTS poh_company_prefix_idx ON public.person_ownership_history (company text_pattern_ops);
CREATE INDEX IF NOT EXISTS poh_maxpct_idx ON public.person_ownership_history (max_pct DESC);
CREATE INDEX IF NOT EXISTS poh_name_prefix_idx ON public.person_ownership_history (shareholder_name text_pattern_ops);
CREATE INDEX IF NOT EXISTS poh_orgnr_idx ON public.person_ownership_history (orgnr);
CREATE INDEX IF NOT EXISTS poh_person_idx ON public.person_ownership_history (shareholder_name, birth_year);
CREATE INDEX IF NOT EXISTS poh_trend_idx ON public.person_ownership_history (trend, max_pct DESC);
ANALYZE public.person_ownership_history;
CREATE TABLE public.market_quotes (
  orgnr text PRIMARY KEY,
  isin text NOT NULL,
  symbol text NOT NULL,
  market text,
  currency text,
  listed_name text NOT NULL,
  last_price numeric,
  volume numeric,
  turnover numeric,
  quote_date text,
  source text NOT NULL DEFAULT 'Euronext',
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.market_quotes TO authenticated;
GRANT ALL ON public.market_quotes TO service_role;
ALTER TABLE public.market_quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in users read market quotes" ON public.market_quotes FOR SELECT TO authenticated USING (true);

CREATE VIEW public.retail_market_targets WITH (security_invoker = true) AS
SELECT h.orgnr, h.name, h.industry, h.owner_count, h.entry_count, h.exit_count,
  p.total_shareholders, p.retail_pct, p.direct_person_pct, p.direct_person_shift_pp, p.retail_shift_pp,
  m.symbol, m.isin, m.market, m.currency, m.last_price, m.volume, m.turnover, m.quote_date, m.updated_at AS quote_updated_at
FROM public.historical_playbook_candidates h
JOIN public.market_quotes m USING (orgnr)
LEFT JOIN public.company_platform_profile p USING (orgnr)
WHERE h.owner_count >= 20 AND h.entry_count > 0 AND h.exit_count > 0;
GRANT SELECT ON public.retail_market_targets TO authenticated;
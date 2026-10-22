CREATE TABLE public.person_ownership_history (
  id bigserial PRIMARY KEY,
  orgnr text NOT NULL,
  company text,
  shareholder_name text NOT NULL,
  birth_year integer,
  postal text,
  shares_2022 bigint, shares_2023 bigint, shares_2024 bigint, shares_2025 bigint,
  pct_2022 numeric, pct_2023 numeric, pct_2024 numeric, pct_2025 numeric,
  first_year integer NOT NULL,
  last_year integer NOT NULL,
  years_present integer NOT NULL DEFAULT 1,
  trend text NOT NULL DEFAULT 'stable',
  max_pct numeric
);
GRANT SELECT ON public.person_ownership_history TO authenticated;
GRANT ALL ON public.person_ownership_history TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.person_ownership_history_id_seq TO service_role;
ALTER TABLE public.person_ownership_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read ownership history" ON public.person_ownership_history FOR SELECT TO authenticated
USING (public.has_role(auth.uid(), 'admin'));
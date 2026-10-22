CREATE TABLE public.custody_platforms (
  id text PRIMARY KEY, name text NOT NULL, category text NOT NULL, category_label text, country text,
  is_nominee boolean NOT NULL DEFAULT true, investor_profile text, sort_order int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.company_platform_holdings (
  year int NOT NULL, orgnr text NOT NULL, platform_id text NOT NULL, shares numeric, pct numeric, accounts int,
  PRIMARY KEY (year, orgnr, platform_id));
CREATE INDEX cph_platform_year_idx ON public.company_platform_holdings (platform_id, year, pct DESC);
CREATE INDEX cph_orgnr_idx ON public.company_platform_holdings (orgnr);
CREATE TABLE public.nominee_accounts (
  id bigserial PRIMARY KEY, year int NOT NULL, account_name text NOT NULL, shareholder_ref text, country text,
  platform_id text, companies int, positions int);
CREATE INDEX na_platform_idx ON public.nominee_accounts (platform_id, year);
CREATE TABLE public.company_platform_profile (
  orgnr text PRIMARY KEY, company_name text, year int, prev_year int, is_asa boolean, vps_registered boolean,
  in_prev_year boolean, total_shareholders int, total_shares numeric, nominee_pct numeric, nominee_accounts int,
  retail_pct numeric, nordic_bank_pct numeric, nordic_broker_pct numeric, private_bank_pct numeric,
  global_custody_pct numeric, investment_bank_pct numeric, european_bank_pct numeric, infrastructure_pct numeric,
  fund_pct numeric, direct_person_count int, direct_person_pct numeric, persons_under_35 int, persons_35_54 int,
  persons_55_69 int, persons_70_plus int, new_direct_persons int, exited_direct_persons int,
  dominant_platform_id text, dominant_platform_pct numeric, platform_ids text[], platform_categories text[],
  nominee_shift_pp numeric, retail_shift_pp numeric, foreign_institutional_shift_pp numeric,
  direct_person_shift_pp numeric, foreign_institutional_pct numeric, updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX cpp_name_idx ON public.company_platform_profile (lower(company_name) text_pattern_ops);
CREATE INDEX cpp_retail_idx ON public.company_platform_profile (retail_pct DESC);
CREATE TABLE public.platform_stats (year int PRIMARY KEY, stats jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now());

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['custody_platforms','company_platform_holdings','nominee_accounts','company_platform_profile','platform_stats'] LOOP
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY "Admins read" ON public.%I FOR SELECT TO authenticated USING ((SELECT public.has_role(auth.uid(), ''admin''::public.app_role)))', t);
  END LOOP;
END $$;
GRANT USAGE ON SEQUENCE public.nominee_accounts_id_seq TO service_role;
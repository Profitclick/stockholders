-- Public procurement awards ingested from Doffin
CREATE TABLE public.contract_awards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notice_id text NOT NULL,
  heading text,
  buyer_name text,
  buyer_orgnr text,
  awarded_name text,
  awarded_name_norm text,
  matched_orgnr text,
  estimated_value numeric,
  currency text,
  publication_date date,
  cpv_codes jsonb DEFAULT '[]'::jsonb,
  doffin_url text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notice_id, awarded_name_norm)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contract_awards TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contract_awards TO anon;
GRANT ALL ON public.contract_awards TO service_role;

ALTER TABLE public.contract_awards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read awards" ON public.contract_awards FOR SELECT USING (true);
CREATE POLICY "Public write awards" ON public.contract_awards FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update awards" ON public.contract_awards FOR UPDATE USING (true);
CREATE POLICY "Public delete awards" ON public.contract_awards FOR DELETE USING (true);

CREATE INDEX idx_contract_awards_matched ON public.contract_awards (matched_orgnr);
CREATE INDEX idx_contract_awards_norm ON public.contract_awards (awarded_name_norm);

-- Flattened, query-optimised signal layer for commercial playbooks
CREATE TABLE public.company_signals (
  orgnr text PRIMARY KEY,
  name text NOT NULL,
  industry text,
  nace_code text,
  nace_prefix text,
  org_form text,
  municipality text,
  municipality_no text,
  postcode text,
  founded_date date,
  company_age_years numeric,
  revenue numeric,
  operating_profit numeric,
  equity numeric,
  total_debt numeric,
  profit_margin numeric,
  ceo_name text,
  chair_name text,
  board_size integer,
  email text,
  phone text,
  website text,
  has_majority_change boolean NOT NULL DEFAULT false,
  has_new_shareholder boolean NOT NULL DEFAULT false,
  has_capital_increase boolean NOT NULL DEFAULT false,
  trigger_count integer NOT NULL DEFAULT 0,
  skattefunn_count integer NOT NULL DEFAULT 0,
  grants_count integer NOT NULL DEFAULT 0,
  eu_grants_count integer NOT NULL DEFAULT 0,
  research_council_count integer NOT NULL DEFAULT 0,
  ip_rights_count integer NOT NULL DEFAULT 0,
  open_jobs_count integer NOT NULL DEFAULT 0,
  contract_count integer NOT NULL DEFAULT 0,
  contract_value numeric NOT NULL DEFAULT 0,
  lead_score numeric NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.company_signals TO authenticated;
GRANT SELECT ON public.company_signals TO anon;
GRANT ALL ON public.company_signals TO service_role;

ALTER TABLE public.company_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read signals" ON public.company_signals FOR SELECT USING (true);
CREATE POLICY "Public write signals" ON public.company_signals FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update signals" ON public.company_signals FOR UPDATE USING (true);
CREATE POLICY "Public delete signals" ON public.company_signals FOR DELETE USING (true);

CREATE INDEX idx_signals_score ON public.company_signals (lead_score DESC);
CREATE INDEX idx_signals_nace ON public.company_signals (nace_prefix);
CREATE INDEX idx_signals_muni ON public.company_signals (municipality);
CREATE INDEX idx_signals_revenue ON public.company_signals (revenue);

-- Name normaliser used to match Doffin winner names to registered companies
CREATE OR REPLACE FUNCTION public.normalize_company_name(p_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT nullif(
    trim(
      regexp_replace(
        regexp_replace(
          upper(coalesce(p_name, '')),
          '\s+(AS|ASA|ANS|DA|SA|BA|NUF|KS|AB|A/S)\.?$', '', 'g'
        ),
        '[^A-ZÆØÅ0-9 ]', '', 'g'
      )
    ),
    ''
  );
$$;

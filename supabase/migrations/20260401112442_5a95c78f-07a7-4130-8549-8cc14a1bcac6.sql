
-- Create job status enum
CREATE TYPE public.job_status AS ENUM ('queued', 'running', 'completed', 'failed');

-- Create dataset type enum
CREATE TYPE public.dataset_type AS ENUM ('shareholder', 'price', 'crypto', 'crm', 'sector', 'demographic', 'plugin');

-- Timestamp trigger function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Jobs table
CREATE TABLE public.jobs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  type TEXT NOT NULL,
  status public.job_status NOT NULL DEFAULT 'queued',
  progress FLOAT NOT NULL DEFAULT 0,
  total_batches INT NOT NULL DEFAULT 0,
  current_batch INT NOT NULL DEFAULT 0,
  errors_count INT NOT NULL DEFAULT 0,
  warnings_count INT NOT NULL DEFAULT 0,
  estimated_time_remaining INT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Shareholder raw table
CREATE TABLE public.shareholder_raw (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  shareholder_name TEXT,
  shareholder_type TEXT,
  birth_year INT,
  gender TEXT,
  municipality TEXT,
  postcode TEXT,
  company_name TEXT,
  orgnr TEXT,
  shares INT,
  year INT,
  dataset_type public.dataset_type NOT NULL DEFAULT 'shareholder',
  import_job_id UUID REFERENCES public.jobs(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Investors table
CREATE TABLE public.investors (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT,
  birth_year INT,
  gender TEXT,
  municipality TEXT,
  region TEXT,
  portfolio_size INT NOT NULL DEFAULT 0,
  portfolio_companies JSONB DEFAULT '[]',
  portfolio_industries JSONB DEFAULT '[]',
  yoy_changes JSONB DEFAULT '{}',
  capital_estimate FLOAT DEFAULT 0,
  ias_score FLOAT DEFAULT 0,
  ssb_context JSONB DEFAULT '{}',
  brreg_context JSONB DEFAULT '{}',
  custom_scores JSONB DEFAULT '{}',
  demographics JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Companies table
CREATE TABLE public.companies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  orgnr TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  industry TEXT,
  size TEXT,
  brreg_data JSONB DEFAULT '{}',
  enriched BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Profiles table
CREATE TABLE public.profiles (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  rules JSONB DEFAULT '{}',
  weights JSONB DEFAULT '{}',
  thresholds JSONB DEFAULT '{}',
  is_prebuilt BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Segments table
CREATE TABLE public.segments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  profile_id UUID REFERENCES public.profiles(id) ON DELETE CASCADE,
  investor_ids JSONB DEFAULT '[]',
  summary JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Exports archive table
CREATE TABLE public.exports_archive (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  segment_id UUID REFERENCES public.segments(id),
  profile_id UUID REFERENCES public.profiles(id),
  format TEXT NOT NULL DEFAULT 'csv',
  file_path TEXT,
  row_count INT NOT NULL DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Plugins table
CREATE TABLE public.plugins (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  enabled BOOLEAN NOT NULL DEFAULT true,
  config JSONB DEFAULT '{}',
  dataset_type TEXT,
  row_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Audit log table
CREATE TABLE public.audit_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  action TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  details JSONB DEFAULT '{}',
  user_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shareholder_raw ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.investors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exports_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.plugins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Public read/write policies (internal tool - no auth)
CREATE POLICY "Public read" ON public.jobs FOR SELECT USING (true);
CREATE POLICY "Public write" ON public.jobs FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update" ON public.jobs FOR UPDATE USING (true);
CREATE POLICY "Public delete" ON public.jobs FOR DELETE USING (true);

CREATE POLICY "Public read" ON public.shareholder_raw FOR SELECT USING (true);
CREATE POLICY "Public write" ON public.shareholder_raw FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update" ON public.shareholder_raw FOR UPDATE USING (true);
CREATE POLICY "Public delete" ON public.shareholder_raw FOR DELETE USING (true);

CREATE POLICY "Public read" ON public.investors FOR SELECT USING (true);
CREATE POLICY "Public write" ON public.investors FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update" ON public.investors FOR UPDATE USING (true);
CREATE POLICY "Public delete" ON public.investors FOR DELETE USING (true);

CREATE POLICY "Public read" ON public.companies FOR SELECT USING (true);
CREATE POLICY "Public write" ON public.companies FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update" ON public.companies FOR UPDATE USING (true);
CREATE POLICY "Public delete" ON public.companies FOR DELETE USING (true);

CREATE POLICY "Public read" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Public write" ON public.profiles FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update" ON public.profiles FOR UPDATE USING (true);
CREATE POLICY "Public delete" ON public.profiles FOR DELETE USING (true);

CREATE POLICY "Public read" ON public.segments FOR SELECT USING (true);
CREATE POLICY "Public write" ON public.segments FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update" ON public.segments FOR UPDATE USING (true);
CREATE POLICY "Public delete" ON public.segments FOR DELETE USING (true);

CREATE POLICY "Public read" ON public.exports_archive FOR SELECT USING (true);
CREATE POLICY "Public write" ON public.exports_archive FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update" ON public.exports_archive FOR UPDATE USING (true);
CREATE POLICY "Public delete" ON public.exports_archive FOR DELETE USING (true);

CREATE POLICY "Public read" ON public.plugins FOR SELECT USING (true);
CREATE POLICY "Public write" ON public.plugins FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update" ON public.plugins FOR UPDATE USING (true);
CREATE POLICY "Public delete" ON public.plugins FOR DELETE USING (true);

CREATE POLICY "Public read" ON public.audit_log FOR SELECT USING (true);
CREATE POLICY "Public write" ON public.audit_log FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update" ON public.audit_log FOR UPDATE USING (true);
CREATE POLICY "Public delete" ON public.audit_log FOR DELETE USING (true);

-- Indexes
CREATE INDEX idx_shareholder_raw_orgnr ON public.shareholder_raw(orgnr);
CREATE INDEX idx_shareholder_raw_name ON public.shareholder_raw(shareholder_name);
CREATE INDEX idx_shareholder_raw_job ON public.shareholder_raw(import_job_id);
CREATE INDEX idx_investors_name ON public.investors(name);
CREATE INDEX idx_investors_ias ON public.investors(ias_score);
CREATE INDEX idx_investors_municipality ON public.investors(municipality);
CREATE INDEX idx_companies_orgnr ON public.companies(orgnr);
CREATE INDEX idx_jobs_status ON public.jobs(status);
CREATE INDEX idx_audit_log_action ON public.audit_log(action);
CREATE INDEX idx_audit_log_entity ON public.audit_log(entity_type, entity_id);

-- Update triggers
CREATE TRIGGER update_jobs_updated_at BEFORE UPDATE ON public.jobs FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_investors_updated_at BEFORE UPDATE ON public.investors FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_companies_updated_at BEFORE UPDATE ON public.companies FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_plugins_updated_at BEFORE UPDATE ON public.plugins FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

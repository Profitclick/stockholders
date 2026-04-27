
-- Add 'business' to dataset_type enum
ALTER TYPE public.dataset_type ADD VALUE IF NOT EXISTS 'business';

-- Create business_raw table
CREATE TABLE public.business_raw (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  orgnr text,
  name text,
  industry text,
  address text,
  email text,
  phone text,
  website text,
  employees integer,
  municipality text,
  region text,
  metadata jsonb DEFAULT '{}'::jsonb,
  import_job_id uuid REFERENCES public.jobs(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.business_raw ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON public.business_raw FOR SELECT TO public USING (true);
CREATE POLICY "Public write" ON public.business_raw FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Public update" ON public.business_raw FOR UPDATE TO public USING (true);
CREATE POLICY "Public delete" ON public.business_raw FOR DELETE TO public USING (true);
CREATE INDEX idx_business_raw_orgnr ON public.business_raw(orgnr);
CREATE INDEX idx_business_raw_name ON public.business_raw(name);

-- Create parquet_imports table
CREATE TABLE public.parquet_imports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text NOT NULL,
  schema jsonb DEFAULT '{}'::jsonb,
  row_count integer DEFAULT 0,
  status text DEFAULT 'pending',
  storage_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.parquet_imports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON public.parquet_imports FOR SELECT TO public USING (true);
CREATE POLICY "Public write" ON public.parquet_imports FOR INSERT TO public WITH CHECK (true);
CREATE POLICY "Public update" ON public.parquet_imports FOR UPDATE TO public USING (true);
CREATE POLICY "Public delete" ON public.parquet_imports FOR DELETE TO public USING (true);

-- Add columns to companies
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS email text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS website text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS geo_context jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS eu_context jsonb DEFAULT '{}'::jsonb;
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS datanorge_context jsonb DEFAULT '{}'::jsonb;

-- Add columns to investors
ALTER TABLE public.investors ADD COLUMN IF NOT EXISTS risk_score double precision DEFAULT 0;
ALTER TABLE public.investors ADD COLUMN IF NOT EXISTS sector_score double precision DEFAULT 0;
ALTER TABLE public.investors ADD COLUMN IF NOT EXISTS capital_score double precision DEFAULT 0;
ALTER TABLE public.investors ADD COLUMN IF NOT EXISTS velocity_score double precision DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_shareholder_raw_name 
  ON public.shareholder_raw (shareholder_name);

CREATE INDEX IF NOT EXISTS idx_shareholder_raw_orgnr 
  ON public.shareholder_raw (orgnr);
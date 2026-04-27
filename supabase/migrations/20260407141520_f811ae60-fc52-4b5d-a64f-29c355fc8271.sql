CREATE INDEX IF NOT EXISTS idx_shareholder_raw_cleanup_postcode 
ON public.shareholder_raw (id) 
WHERE municipality IS NULL AND postcode IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_shareholder_raw_cleanup_type
ON public.shareholder_raw (id)
WHERE shareholder_type IS NOT NULL AND length(shareholder_type) > 10;
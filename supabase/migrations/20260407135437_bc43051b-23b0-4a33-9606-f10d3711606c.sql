
-- Index for postcode cleanup: rows where postcode starts with 4 digits followed by text and municipality is null
CREATE INDEX IF NOT EXISTS idx_shareholder_raw_postcode_cleanup 
ON public.shareholder_raw (id)
WHERE postcode IS NOT NULL 
  AND postcode ~ '^\d{4}\s+\S'
  AND (municipality IS NULL OR municipality = '');

-- Index for shareholder_type cleanup: garbled entries
CREATE INDEX IF NOT EXISTS idx_shareholder_raw_type_cleanup
ON public.shareholder_raw (id)
WHERE shareholder_type IS NOT NULL 
  AND length(shareholder_type) > 5
  AND shareholder_type ~ '[^\x20-\x7E]';

-- Also recreate the function with much smaller batch and simpler regex
CREATE OR REPLACE FUNCTION public.cleanup_shareholder_data(p_limit integer DEFAULT 5000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_postcode_updated INT := 0;
  v_type_cleaned INT := 0;
  v_pc_remaining INT := 0;
  v_type_remaining INT := 0;
BEGIN
  PERFORM set_config('statement_timeout', '60s', true);

  -- Extract city from postcode into municipality (batch)
  UPDATE public.shareholder_raw
  SET 
    municipality = UPPER(TRIM(substring(postcode from '^\d{4}\s+(.*)'))),
    postcode = substring(postcode from '^\d{4}')
  WHERE id IN (
    SELECT id FROM public.shareholder_raw
    WHERE postcode IS NOT NULL 
      AND postcode ~ '^\d{4}\s+\S'
      AND (municipality IS NULL OR municipality = '')
    LIMIT p_limit
  );
  GET DIAGNOSTICS v_postcode_updated = ROW_COUNT;

  -- Clean garbled shareholder_type (just NULL them out)
  UPDATE public.shareholder_raw
  SET shareholder_type = NULL
  WHERE id IN (
    SELECT id FROM public.shareholder_raw
    WHERE shareholder_type IS NOT NULL 
      AND length(shareholder_type) > 5
      AND shareholder_type ~ '[^\x20-\x7E]'
    LIMIT p_limit
  );
  GET DIAGNOSTICS v_type_cleaned = ROW_COUNT;

  -- Quick remaining check using the partial indexes
  SELECT COUNT(*) INTO v_pc_remaining FROM (
    SELECT 1 FROM public.shareholder_raw
    WHERE postcode IS NOT NULL AND postcode ~ '^\d{4}\s+\S' AND (municipality IS NULL OR municipality = '')
    LIMIT 1
  ) a;

  SELECT COUNT(*) INTO v_type_remaining FROM (
    SELECT 1 FROM public.shareholder_raw
    WHERE shareholder_type IS NOT NULL AND length(shareholder_type) > 5 AND shareholder_type ~ '[^\x20-\x7E]'
    LIMIT 1
  ) b;

  RETURN jsonb_build_object(
    'postcode_updated', v_postcode_updated,
    'type_cleaned', v_type_cleaned,
    'remaining', v_pc_remaining + v_type_remaining,
    'done', (v_pc_remaining + v_type_remaining) = 0
  );
END;
$function$;

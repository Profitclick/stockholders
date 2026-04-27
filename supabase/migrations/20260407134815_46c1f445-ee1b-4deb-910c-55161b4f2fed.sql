
CREATE OR REPLACE FUNCTION public.cleanup_shareholder_data(p_limit integer DEFAULT 50000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_postcode_updated INT := 0;
  v_type_cleaned INT := 0;
  v_remaining INT := 0;
BEGIN
  PERFORM set_config('statement_timeout', '240s', true);

  -- Extract city from postcode into municipality
  WITH to_fix AS (
    SELECT id FROM public.shareholder_raw
    WHERE postcode IS NOT NULL 
      AND postcode ~ '^\d{4}\s+[A-Za-zÆØÅæøå]'
      AND (municipality IS NULL OR municipality = '')
    LIMIT p_limit
  ),
  updated AS (
    UPDATE public.shareholder_raw sr
    SET 
      municipality = UPPER(TRIM(regexp_replace(sr.postcode, '^\d{4}\s*', ''))),
      postcode = substring(sr.postcode from '^\d{4}')
    FROM to_fix
    WHERE sr.id = to_fix.id
    RETURNING sr.id
  )
  SELECT COUNT(*) INTO v_postcode_updated FROM updated;

  -- Clean garbled shareholder_type
  WITH to_clean AS (
    SELECT id FROM public.shareholder_raw
    WHERE shareholder_type IS NOT NULL 
      AND shareholder_type ~ '[^\x20-\x7EÆØÅæøå0-9]'
    LIMIT p_limit
  ),
  cleaned AS (
    UPDATE public.shareholder_raw sr
    SET shareholder_type = CASE
      WHEN sr.shareholder_type ~* '(AS|ASA|ENK|NUF|ANS|DA|SA|BA|KS)\s' 
        THEN UPPER(TRIM((regexp_match(sr.shareholder_type, '(AS|ASA|ENK|NUF|ANS|DA|SA|BA|KS)', 'i'))[1]))
      ELSE NULL
    END
    FROM to_clean
    WHERE sr.id = to_clean.id
    RETURNING sr.id
  )
  SELECT COUNT(*) INTO v_type_cleaned FROM cleaned;

  -- Check remaining
  SELECT COUNT(*) INTO v_remaining FROM public.shareholder_raw
  WHERE (postcode IS NOT NULL AND postcode ~ '^\d{4}\s+[A-Za-zÆØÅæøå]' AND (municipality IS NULL OR municipality = ''))
     OR (shareholder_type IS NOT NULL AND shareholder_type ~ '[^\x20-\x7EÆØÅæøå0-9]');

  RETURN jsonb_build_object(
    'postcode_updated', v_postcode_updated,
    'type_cleaned', v_type_cleaned,
    'remaining', v_remaining,
    'done', v_remaining = 0
  );
END;
$function$;

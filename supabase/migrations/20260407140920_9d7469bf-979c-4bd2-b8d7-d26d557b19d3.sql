CREATE OR REPLACE FUNCTION public.cleanup_shareholder_data(p_limit integer DEFAULT 5000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout TO '120s'
SET search_path TO 'public'
AS $function$
DECLARE
  v_postcode_updated INT := 0;
  v_type_cleaned INT := 0;
  v_remaining INT := 0;
BEGIN
  -- Fix postcode: "4020 STAVANGER" → postcode="4020", municipality="STAVANGER"
  WITH to_fix AS (
    SELECT id FROM public.shareholder_raw
    WHERE postcode IS NOT NULL 
      AND municipality IS NULL
      AND position(' ' in postcode) > 0
    LIMIT p_limit
  ),
  updated AS (
    UPDATE public.shareholder_raw sr
    SET 
      municipality = UPPER(TRIM(substring(sr.postcode from position(' ' in sr.postcode) + 1))),
      postcode = TRIM(substring(sr.postcode from 1 for position(' ' in sr.postcode) - 1))
    FROM to_fix
    WHERE sr.id = to_fix.id
    RETURNING sr.id
  )
  SELECT COUNT(*) INTO v_postcode_updated FROM updated;

  -- Clean garbled shareholder_type (just NULL long ones)
  WITH to_clean AS (
    SELECT id FROM public.shareholder_raw
    WHERE shareholder_type IS NOT NULL 
      AND length(shareholder_type) > 10
    LIMIT p_limit
  ),
  cleaned AS (
    UPDATE public.shareholder_raw sr
    SET shareholder_type = NULL
    FROM to_clean
    WHERE sr.id = to_clean.id
    RETURNING sr.id
  )
  SELECT COUNT(*) INTO v_type_cleaned FROM cleaned;

  -- Quick remaining check
  SELECT COUNT(*) INTO v_remaining FROM (
    SELECT 1 FROM public.shareholder_raw
    WHERE (postcode IS NOT NULL AND municipality IS NULL AND position(' ' in postcode) > 0)
       OR (shareholder_type IS NOT NULL AND length(shareholder_type) > 10)
    LIMIT 1
  ) a;

  RETURN jsonb_build_object(
    'postcode_updated', v_postcode_updated,
    'type_cleaned', v_type_cleaned,
    'remaining', v_remaining,
    'done', v_remaining = 0
  );
END;
$function$;
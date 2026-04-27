
CREATE OR REPLACE FUNCTION public.cleanup_shareholder_data(p_limit integer DEFAULT 1000)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout TO '120s'
SET search_path TO 'public'
AS $function$
DECLARE
  v_postcode_updated INT := 0;
  v_type_cleaned INT := 0;
  v_pc_remaining INT := 0;
  v_type_remaining INT := 0;
BEGIN
  -- Fix postcode: "4020 STAVANGER" → postcode="4020", municipality="STAVANGER"
  UPDATE public.shareholder_raw
  SET 
    municipality = UPPER(TRIM(substring(postcode from position(' ' in postcode) + 1))),
    postcode = TRIM(substring(postcode from 1 for position(' ' in postcode) - 1))
  WHERE id IN (
    SELECT id FROM public.shareholder_raw
    WHERE postcode IS NOT NULL 
      AND municipality IS NULL
      AND position(' ' in postcode) > 0
    LIMIT p_limit
  );
  GET DIAGNOSTICS v_postcode_updated = ROW_COUNT;

  -- Clean garbled shareholder_type (just NULL long ones)
  UPDATE public.shareholder_raw
  SET shareholder_type = NULL
  WHERE id IN (
    SELECT id FROM public.shareholder_raw
    WHERE shareholder_type IS NOT NULL 
      AND length(shareholder_type) > 10
    LIMIT p_limit
  );
  GET DIAGNOSTICS v_type_cleaned = ROW_COUNT;

  -- Quick remaining check
  SELECT COUNT(*) INTO v_pc_remaining FROM (
    SELECT 1 FROM public.shareholder_raw
    WHERE postcode IS NOT NULL AND municipality IS NULL AND position(' ' in postcode) > 0
    LIMIT 1
  ) a;

  SELECT COUNT(*) INTO v_type_remaining FROM (
    SELECT 1 FROM public.shareholder_raw
    WHERE shareholder_type IS NOT NULL AND length(shareholder_type) > 10
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

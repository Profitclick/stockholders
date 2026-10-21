DO $$
DECLARE src text;
BEGIN
  SELECT pg_get_functiondef('public.ownership_ai_context(text)'::regprocedure) INTO src;
  src := replace(src,
    $r$AND position(regexp_replace(lower(name), '\s+(as|asa|sa|ans|da)$', '') IN lq) > 0$r$,
    $r$AND lq ~ ('\m' || regexp_replace(regexp_replace(lower(name), '\s+(as|asa|sa|ans|da)$', ''), '([.^$*+?()\[\]{}|\\-])', '\\\1', 'g') || '\M')$r$);
  src := replace(src, $r$'\s+(as|asa|sa|ans|da)$', '')) >= 4$r$, $r$'\s+(as|asa|sa|ans|da)$', '')) >= 5$r$);
  EXECUTE src;
END $$;
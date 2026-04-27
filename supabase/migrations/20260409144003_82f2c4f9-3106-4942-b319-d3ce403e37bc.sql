
-- 1. Re-map garbled plugin_data: extract orgnr from row_data->'font-mono' into the orgnr column
UPDATE public.plugin_data
SET orgnr = TRIM(row_data->>'font-mono')
WHERE orgnr IS NULL
  AND row_data->>'font-mono' IS NOT NULL
  AND LENGTH(TRIM(row_data->>'font-mono')) = 9;

-- 2. Upsert emails/phone from plugin_data into companies
INSERT INTO public.companies (orgnr, name, email, phone)
SELECT
  TRIM(pd.row_data->>'font-mono') AS orgnr,
  COALESCE(NULLIF(TRIM(pd.row_data->>'font-medium'), ''), TRIM(pd.row_data->>'font-mono')) AS name,
  NULLIF(TRIM(pd.row_data->>'text-primary'), '') AS email,
  NULLIF(TRIM(pd.row_data->>'text-primary_href_2'), '') AS phone
FROM public.plugin_data pd
WHERE pd.row_data->>'font-mono' IS NOT NULL
  AND LENGTH(TRIM(pd.row_data->>'font-mono')) = 9
ON CONFLICT (orgnr) DO UPDATE SET
  email = COALESCE(EXCLUDED.email, companies.email),
  phone = COALESCE(EXCLUDED.phone, companies.phone),
  updated_at = now();

-- 3. Create prebuilt marketing profiles
INSERT INTO public.profiles (name, description, is_prebuilt, weights, rules, thresholds) VALUES
(
  'Krypto / CFD — Aktive Tradere',
  'Unge, risiko-tolerante investorer med høy porteføljevekst. Målgruppe for krypto, CFD og derivater.',
  true,
  '{"portfolio_size": 30, "yoy_changes": 25, "entity_type": 10, "industry_exposure": 15, "capital_estimate": 10, "ownership_concentration": 10}'::jsonb,
  '{"ias_score": {"min": 40}, "risk_score": {"min": 60}, "birth_year": {"min": 1980}, "gender": {"eq": "M"}, "municipality": {"in": ["OSLO", "BERGEN", "STAVANGER", "TRONDHEIM"]}}'::jsonb,
  '{"min_score": 40}'::jsonb
),
(
  'Konservativ Fintech — Etablerte Investorer',
  'Eldre, konservative investorer med diversifisert portefølje. Målgruppe for sparing, pensjon og fond.',
  true,
  '{"portfolio_size": 25, "yoy_changes": 10, "entity_type": 15, "industry_exposure": 20, "capital_estimate": 20, "ownership_concentration": 10}'::jsonb,
  '{"ias_score": {"min": 20, "max": 40}, "risk_score": {"max": 40}, "birth_year": {"max": 1979}, "portfolio_size": {"min": 5}}'::jsonb,
  '{"min_score": 20}'::jsonb
),
(
  'B2B Investeringsprodukter — Selskaper',
  'AS-selskaper med 10+ porteføljeselskaper og kontaktinfo. Målgruppe for B2B-salg.',
  true,
  '{"portfolio_size": 30, "yoy_changes": 15, "entity_type": 25, "industry_exposure": 10, "capital_estimate": 15, "ownership_concentration": 5}'::jsonb,
  '{"type": {"eq": "AS"}, "portfolio_size": {"min": 10}}'::jsonb,
  '{"min_score": 30}'::jsonb
)
ON CONFLICT DO NOTHING;

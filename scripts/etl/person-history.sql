-- Builds person_ownership_history (2017–2025) from the yearly register Parquet files.
-- Run: duckdb /tmp/reg/hist.duckdb -c ".read scripts/etl/person-history.sql"  (with files in the cwd or /tmp/reg)
-- Source of record: shareholders bucket in Lovable Cloud Storage (aksjereg-<year>.parquet).
CREATE OR REPLACE TABLE raw AS
SELECT CAST(regexp_extract(filename, '(\d{4})\.parquet', 1) AS INT) AS yr,
       CAST("Orgnr" AS VARCHAR) AS orgnr, "Selskap" AS company, coalesce("Aksjeklasse",'') AS cls,
       upper(trim("Navn aksjonær")) AS name, CAST("Fødselsår/orgnr" AS VARCHAR) AS idf,
       "Postnr/sted" AS postal, TRY_CAST("Antall aksjer" AS BIGINT) AS shares,
       TRY_CAST("Antall aksjer selskap" AS BIGINT) AS total
FROM read_parquet('/tmp/reg/aksjereg-*.parquet', filename=true);

CREATE OR REPLACE TABLE company_total AS
SELECT yr, orgnr, sum(t) AS total FROM (SELECT yr, orgnr, cls, max(total) t FROM raw GROUP BY ALL) GROUP BY ALL;

CREATE OR REPLACE TABLE person_year AS
SELECT r.yr, r.orgnr, r.name, CAST(r.idf AS INT) AS birth_year,
       arg_max(r.company, r.shares) AS company, arg_max(r.postal, r.shares) AS postal,
       sum(r.shares) AS shares,
       round(100.0 * sum(r.shares) / nullif(any_value(c.total), 0), 3) AS pct
FROM raw r JOIN company_total c USING (yr, orgnr)
WHERE regexp_full_match(r.idf, '\d{4}') AND r.name <> '' AND r.shares > 0
GROUP BY r.yr, r.orgnr, r.name, r.idf;

CREATE OR REPLACE TABLE hist AS
WITH p AS (
  SELECT orgnr, name AS shareholder_name, birth_year,
    arg_max(company, yr) AS company, arg_max(postal, yr) AS postal,
    max(shares) FILTER (yr=2017) shares_2017, max(shares) FILTER (yr=2018) shares_2018, max(shares) FILTER (yr=2019) shares_2019,
    max(shares) FILTER (yr=2020) shares_2020, max(shares) FILTER (yr=2021) shares_2021, max(shares) FILTER (yr=2022) shares_2022,
    max(shares) FILTER (yr=2023) shares_2023, max(shares) FILTER (yr=2024) shares_2024, max(shares) FILTER (yr=2025) shares_2025,
    max(pct) FILTER (yr=2017) pct_2017, max(pct) FILTER (yr=2018) pct_2018, max(pct) FILTER (yr=2019) pct_2019,
    max(pct) FILTER (yr=2020) pct_2020, max(pct) FILTER (yr=2021) pct_2021, max(pct) FILTER (yr=2022) pct_2022,
    max(pct) FILTER (yr=2023) pct_2023, max(pct) FILTER (yr=2024) pct_2024, max(pct) FILTER (yr=2025) pct_2025,
    min(yr) first_year, max(yr) last_year, count(*) years_present, max(pct) max_pct,
    arg_min(pct, yr) first_pct
  FROM person_year GROUP BY orgnr, name, birth_year)
SELECT * EXCLUDE (first_pct),
  CASE WHEN last_year < 2025 THEN 'exited'
       WHEN first_year > 2017 THEN 'new_' || first_year
       WHEN pct_2025 - first_pct >= 1 THEN 'increased'
       WHEN pct_2025 - first_pct <= -1 THEN 'decreased'
       ELSE 'stable' END AS trend
FROM p;

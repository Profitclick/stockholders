/**
 * Platform exposure ETL — Aksjonærregisteret (Parquet) → Lovable Cloud.
 *
 * Classifies every non-person shareholder with the shared catalog in src/lib/custodyPlatforms.ts,
 * aggregates platform shares per company for the current and previous register year with DuckDB,
 * and loads the results with the service role (the platform tables are read-only for the app).
 *
 * Usage (sandbox):
 *   bun scripts/etl/platform-exposure.ts --dir /tmp/aksjereg --current 2025 --previous 2024 [--upload]
 * Expects files named aksjereg-<year>.parquet in --dir (download from the Parquet host first).
 * Requires the DuckDB CLI on PATH; --upload requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Papa from "papaparse";
import {
  CUSTODY_PLATFORMS,
  FOREIGN_INSTITUTIONAL_CATEGORIES,
  PLATFORM_CATEGORIES,
  classifyShareholder,
} from "../../src/lib/custodyPlatforms";

const args = process.argv.slice(2);
const arg = (name: string, fallback?: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const DIR = arg("dir", "/tmp/aksjereg")!;
const CUR = Number(arg("current", "2025"));
const PREV = Number(arg("previous", String(CUR - 1)));
const UPLOAD = args.includes("--upload");
const OUT = join(DIR, "out");
const DB = join(DIR, "etl.duckdb");
mkdirSync(OUT, { recursive: true });

for (const y of [CUR, PREV]) {
  const f = join(DIR, `aksjereg-${y}.parquet`);
  if (!existsSync(f)) throw new Error(`Missing ${f}`);
}

function duck(sql: string, label: string) {
  const t0 = Date.now();
  const res = Bun.spawnSync(["duckdb", DB, "-c", sql], { stdout: "pipe", stderr: "pipe" });
  const err = res.stderr.toString().replace(/-- Loading resources from .*\n?/g, "").trim();
  if (res.exitCode !== 0 || /Error:/i.test(err)) {
    throw new Error(`DuckDB step "${label}" failed: ${err || res.stdout.toString()}`);
  }
  console.log(`✓ ${label} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  return res.stdout.toString();
}

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const src = (y: number) => q(join(DIR, `aksjereg-${y}.parquet`));

// ── 1. Normalize both years into one staging table ─────────────────────────
duck(
  `
  CREATE OR REPLACE TABLE raw AS
  SELECT * FROM (
    ${[CUR, PREV]
      .map(
        (y) => `
    SELECT ${y}::INT AS yr,
           lpad(trim(CAST("Orgnr" AS VARCHAR)), 9, '0') AS orgnr,
           trim("Selskap") AS company,
           coalesce(trim("Aksjeklasse"), '') AS cls,
           trim("Navn aksjonær") AS sh_name,
           coalesce(trim(CAST("Fødselsår/orgnr" AS VARCHAR)), '') AS sh_ref,
           nullif(trim("Landkode"), '') AS country,
           TRY_CAST("Antall aksjer" AS BIGINT) AS shares,
           TRY_CAST("Antall aksjer selskap" AS BIGINT) AS company_shares
    FROM read_parquet(${src(y)})`,
      )
      .join("\n    UNION ALL")}
  ) WHERE sh_name IS NOT NULL AND sh_name <> '' AND orgnr IS NOT NULL;

  COPY (
    SELECT sh_name, sh_ref, any_value(country) AS country
    FROM raw
    WHERE NOT regexp_matches(sh_ref, '^[0-9]{4}$')
    GROUP BY sh_name, sh_ref
  ) TO ${q(join(OUT, "entities.csv"))} (HEADER, DELIMITER ',');
  `,
  "staging + entity export",
);

// ── 2. Classify entities with the shared TypeScript catalog ────────────────
const entities = Papa.parse<{ sh_name: string; sh_ref: string; country: string }>(
  readFileSync(join(OUT, "entities.csv"), "utf8"),
  { header: true, skipEmptyLines: true },
).data;
const mapping: { sh_name: string; sh_ref: string; platform_id: string }[] = [];
for (const e of entities) {
  const p = classifyShareholder(e.sh_name, e.sh_ref);
  if (p) mapping.push({ sh_name: e.sh_name, sh_ref: e.sh_ref ?? "", platform_id: p.id });
}
writeFileSync(join(OUT, "mapping.csv"), Papa.unparse(mapping));
const platRows = CUSTODY_PLATFORMS.map((p, i) => ({
  platform_id: p.id,
  category: p.category,
  is_nominee: PLATFORM_CATEGORIES[p.category].isNominee,
  foreign_inst: FOREIGN_INSTITUTIONAL_CATEGORIES.includes(p.category),
  sort_order: i,
}));
writeFileSync(join(OUT, "platforms.csv"), Papa.unparse(platRows));
console.log(`✓ classified ${mapping.length} of ${entities.length} entity accounts`);

// ── 3. Aggregate ───────────────────────────────────────────────────────────
const cats = Object.keys(PLATFORM_CATEGORIES);
duck(
  `
  CREATE OR REPLACE TABLE map AS SELECT sh_name, coalesce(sh_ref, '') AS sh_ref, platform_id
    FROM read_csv(${q(join(OUT, "mapping.csv"))}, header = true, all_varchar = true);
  CREATE OR REPLACE TABLE plat AS SELECT platform_id, category, is_nominee::BOOLEAN AS is_nominee,
      foreign_inst::BOOLEAN AS foreign_inst
    FROM read_csv(${q(join(OUT, "platforms.csv"))}, header = true, all_varchar = true);

  -- Company share totals per year (sum over share classes; fall back to holder sum).
  CREATE OR REPLACE TABLE totals AS
  WITH per_class AS (
    SELECT yr, orgnr, cls, max(company_shares) AS cs, sum(shares) AS held, any_value(company) AS company
    FROM raw GROUP BY yr, orgnr, cls
  )
  SELECT yr, orgnr, any_value(company) AS company,
         sum(CASE WHEN coalesce(cs, 0) > 0 THEN cs ELSE held END) AS total_shares
  FROM per_class GROUP BY yr, orgnr;

  CREATE OR REPLACE TABLE classified AS
  SELECT r.yr, r.orgnr, r.sh_name, r.sh_ref, r.country, r.shares, m.platform_id, p.category, p.is_nominee, p.foreign_inst
  FROM raw r JOIN map m ON m.sh_name = r.sh_name AND m.sh_ref = r.sh_ref
  JOIN plat p USING (platform_id);

  CREATE OR REPLACE TABLE holdings AS
  SELECT c.yr AS year, c.orgnr, c.platform_id, any_value(c.category) AS category,
         bool_or(c.is_nominee) AS is_nominee, bool_or(c.foreign_inst) AS foreign_inst,
         sum(c.shares) AS shares,
         CASE WHEN max(t.total_shares) > 0 THEN least(100, round(sum(c.shares) * 100.0 / max(t.total_shares), 4)) ELSE 0 END AS pct,
         count(DISTINCT c.sh_name || '|' || c.sh_ref) AS accounts
  FROM classified c JOIN totals t ON t.yr = c.yr AND t.orgnr = c.orgnr
  GROUP BY c.yr, c.orgnr, c.platform_id;

  -- Companies in scope: ASA, or any nominee holding (proof of VPS / CSD registration), or fund holding.
  CREATE OR REPLACE TABLE scope AS
  SELECT t.yr, t.orgnr, t.company, t.total_shares,
         (t.company LIKE '% ASA' OR t.company LIKE '% ASA %') AS is_asa,
         ((t.company LIKE '% ASA' OR t.company LIKE '% ASA %') OR EXISTS (
            SELECT 1 FROM holdings h WHERE h.year = t.yr AND h.orgnr = t.orgnr AND h.is_nominee)) AS vps_registered
  FROM totals t
  WHERE (t.company LIKE '% ASA' OR t.company LIKE '% ASA %')
     OR EXISTS (SELECT 1 FROM holdings h WHERE h.year = t.yr AND h.orgnr = t.orgnr);

  CREATE OR REPLACE TABLE persons AS
  SELECT r.yr, r.orgnr, r.sh_name, TRY_CAST(r.sh_ref AS INT) AS birth_year, sum(r.shares) AS shares
  FROM raw r JOIN scope s ON s.yr = r.yr AND s.orgnr = r.orgnr
  WHERE regexp_matches(r.sh_ref, '^[0-9]{4}$')
  GROUP BY r.yr, r.orgnr, r.sh_name, r.sh_ref;

  CREATE OR REPLACE TABLE cat_pct AS
  SELECT year, orgnr,
    ${cats.map((c) => `coalesce(sum(pct) FILTER (WHERE category = '${c}'), 0) AS ${c}_pct`).join(",\n    ")},
    coalesce(sum(pct) FILTER (WHERE is_nominee), 0) AS nominee_pct,
    coalesce(sum(pct) FILTER (WHERE foreign_inst), 0) AS foreign_inst_pct,
    coalesce(sum(accounts) FILTER (WHERE is_nominee), 0) AS nominee_accounts
  FROM holdings GROUP BY year, orgnr;

  CREATE OR REPLACE TABLE person_stats AS
  SELECT p.yr, p.orgnr, count(*) AS n,
    CASE WHEN max(s.total_shares) > 0 THEN least(100, round(sum(p.shares) * 100.0 / max(s.total_shares), 4)) ELSE 0 END AS pct,
    count(*) FILTER (WHERE p.yr - p.birth_year < 35) AS a_u35,
    count(*) FILTER (WHERE p.yr - p.birth_year BETWEEN 35 AND 54) AS a_35_54,
    count(*) FILTER (WHERE p.yr - p.birth_year BETWEEN 55 AND 69) AS a_55_69,
    count(*) FILTER (WHERE p.yr - p.birth_year >= 70) AS a_70p
  FROM persons p JOIN scope s ON s.yr = p.yr AND s.orgnr = p.orgnr
  GROUP BY p.yr, p.orgnr;

  CREATE OR REPLACE TABLE person_flow AS
  SELECT orgnr,
    count(*) FILTER (WHERE in_cur AND NOT in_prev) AS new_persons,
    count(*) FILTER (WHERE in_prev AND NOT in_cur) AS exited_persons
  FROM (
    SELECT orgnr, sh_name, birth_year, bool_or(yr = ${CUR}) AS in_cur, bool_or(yr = ${PREV}) AS in_prev
    FROM persons GROUP BY orgnr, sh_name, birth_year
  ) GROUP BY orgnr;

  CREATE OR REPLACE TABLE dominant AS
  SELECT orgnr, arg_max(platform_id, pct) AS platform_id, max(pct) AS pct
  FROM holdings WHERE year = ${CUR} AND is_nominee GROUP BY orgnr;

  CREATE OR REPLACE TABLE profile AS
  SELECT s.orgnr, s.company AS company_name, ${CUR} AS year, ${PREV} AS prev_year,
    s.is_asa, s.vps_registered, (sp.orgnr IS NOT NULL) AS in_prev_year,
    (SELECT count(DISTINCT r.sh_name || '|' || r.sh_ref) FROM raw r WHERE r.yr = ${CUR} AND r.orgnr = s.orgnr) AS total_shareholders,
    s.total_shares,
    round(coalesce(c.nominee_pct, 0), 3) AS nominee_pct,
    coalesce(c.nominee_accounts, 0)::INT AS nominee_accounts,
    ${cats.map((k) => `round(coalesce(c.${k}_pct, 0), 3) AS ${k}_pct`).join(",\n    ")},
    coalesce(ps.n, 0)::INT AS direct_person_count,
    round(coalesce(ps.pct, 0), 3) AS direct_person_pct,
    coalesce(ps.a_u35, 0)::INT AS persons_under_35,
    coalesce(ps.a_35_54, 0)::INT AS persons_35_54,
    coalesce(ps.a_55_69, 0)::INT AS persons_55_69,
    coalesce(ps.a_70p, 0)::INT AS persons_70_plus,
    CASE WHEN sp.orgnr IS NOT NULL THEN coalesce(pf.new_persons, 0)::INT END AS new_direct_persons,
    CASE WHEN sp.orgnr IS NOT NULL THEN coalesce(pf.exited_persons, 0)::INT END AS exited_direct_persons,
    d.platform_id AS dominant_platform_id,
    round(d.pct, 3) AS dominant_platform_pct,
    coalesce((SELECT list(h.platform_id ORDER BY h.pct DESC) FROM holdings h WHERE h.year = ${CUR} AND h.orgnr = s.orgnr), []) AS platform_ids,
    coalesce((SELECT list(DISTINCT h.category) FROM holdings h WHERE h.year = ${CUR} AND h.orgnr = s.orgnr), []) AS platform_categories,
    CASE WHEN sp.orgnr IS NOT NULL THEN round(coalesce(c.nominee_pct, 0) - coalesce(cp.nominee_pct, 0), 3) END AS nominee_shift_pp,
    CASE WHEN sp.orgnr IS NOT NULL THEN round(coalesce(c.retail_pct, 0) - coalesce(cp.retail_pct, 0), 3) END AS retail_shift_pp,
    CASE WHEN sp.orgnr IS NOT NULL THEN round(coalesce(c.foreign_inst_pct, 0) - coalesce(cp.foreign_inst_pct, 0), 3) END AS foreign_institutional_shift_pp,
    CASE WHEN sp.orgnr IS NOT NULL THEN round(coalesce(ps.pct, 0) - coalesce(pp.pct, 0), 3) END AS direct_person_shift_pp,
    round(coalesce(c.foreign_inst_pct, 0), 3) AS foreign_institutional_pct
  FROM scope s
  LEFT JOIN scope sp ON sp.yr = ${PREV} AND sp.orgnr = s.orgnr
  LEFT JOIN cat_pct c ON c.year = ${CUR} AND c.orgnr = s.orgnr
  LEFT JOIN cat_pct cp ON cp.year = ${PREV} AND cp.orgnr = s.orgnr
  LEFT JOIN person_stats ps ON ps.yr = ${CUR} AND ps.orgnr = s.orgnr
  LEFT JOIN person_stats pp ON pp.yr = ${PREV} AND pp.orgnr = s.orgnr
  LEFT JOIN person_flow pf ON pf.orgnr = s.orgnr
  LEFT JOIN dominant d ON d.orgnr = s.orgnr
  WHERE s.yr = ${CUR};

  CREATE OR REPLACE TABLE accounts AS
  SELECT yr AS year, sh_name AS account_name, sh_ref AS shareholder_ref, any_value(country) AS country,
         any_value(platform_id) AS platform_id, count(DISTINCT orgnr)::INT AS companies, count(*)::INT AS positions
  FROM classified GROUP BY yr, sh_name, sh_ref;

  -- Market sizing: persons holding VPS-registered shares in their own name.
  CREATE OR REPLACE TABLE person_market AS
  WITH vps_persons AS (
    SELECT p.yr, p.sh_name, p.birth_year, count(DISTINCT p.orgnr) AS positions
    FROM persons p JOIN scope s ON s.yr = p.yr AND s.orgnr = p.orgnr AND s.vps_registered
    GROUP BY p.yr, p.sh_name, p.birth_year
  ), flows AS (
    SELECT sh_name, birth_year,
      count(DISTINCT orgnr) FILTER (WHERE in_cur AND NOT in_prev) AS added,
      count(DISTINCT orgnr) FILTER (WHERE in_prev AND NOT in_cur) AS removed
    FROM (
      SELECT p.orgnr, p.sh_name, p.birth_year, bool_or(p.yr = ${CUR}) AS in_cur, bool_or(p.yr = ${PREV}) AS in_prev
      FROM persons p JOIN scope s ON s.yr = p.yr AND s.orgnr = p.orgnr AND s.vps_registered
      GROUP BY p.orgnr, p.sh_name, p.birth_year
    ) GROUP BY sh_name, birth_year
  )
  SELECT
    count(*) FILTER (WHERE v.yr = ${CUR}) AS persons,
    count(*) FILTER (WHERE v.yr = ${PREV}) AS persons_prev,
    count(*) FILTER (WHERE v.yr = ${CUR} AND v.positions >= 2) AS persons_2plus,
    count(*) FILTER (WHERE v.yr = ${CUR} AND v.positions >= 5) AS persons_5plus,
    count(*) FILTER (WHERE v.yr = ${CUR} AND v.positions >= 10) AS persons_10plus,
    count(*) FILTER (WHERE v.yr = ${CUR} AND ${CUR} - v.birth_year < 35) AS age_under_35,
    count(*) FILTER (WHERE v.yr = ${CUR} AND ${CUR} - v.birth_year BETWEEN 35 AND 54) AS age_35_54,
    count(*) FILTER (WHERE v.yr = ${CUR} AND ${CUR} - v.birth_year BETWEEN 55 AND 69) AS age_55_69,
    count(*) FILTER (WHERE v.yr = ${CUR} AND ${CUR} - v.birth_year >= 70) AS age_70_plus,
    (SELECT count(*) FROM flows WHERE added > 0) AS persons_added_positions,
    (SELECT count(*) FROM flows WHERE removed > 0) AS persons_removed_positions,
    (SELECT count(*) FROM flows WHERE added + removed >= 3) AS persons_active_3plus
  FROM vps_persons v;

  COPY (SELECT year, orgnr, platform_id, shares::HUGEINT AS shares, pct, accounts::INT AS accounts FROM holdings)
    TO ${q(join(OUT, "holdings.json"))} (FORMAT JSON, ARRAY true);
  COPY (SELECT * FROM profile) TO ${q(join(OUT, "profile.json"))} (FORMAT JSON, ARRAY true);
  COPY (SELECT * FROM accounts) TO ${q(join(OUT, "accounts.json"))} (FORMAT JSON, ARRAY true);
  COPY (SELECT * FROM person_market) TO ${q(join(OUT, "person_market.json"))} (FORMAT JSON, ARRAY true);
  `,
  "aggregation",
);

const holdings = JSON.parse(readFileSync(join(OUT, "holdings.json"), "utf8"));
const profile = JSON.parse(readFileSync(join(OUT, "profile.json"), "utf8"));
const accounts = JSON.parse(readFileSync(join(OUT, "accounts.json"), "utf8"));
const personMarket = JSON.parse(readFileSync(join(OUT, "person_market.json"), "utf8"))[0];

const curProfile = profile as any[];
const stats = {
  year: CUR,
  prev_year: PREV,
  companies_in_scope: curProfile.length,
  vps_registered_companies: curProfile.filter((p) => p.vps_registered).length,
  asa_companies: curProfile.filter((p) => p.is_asa).length,
  companies_with_retail: curProfile.filter((p) => p.retail_pct > 0).length,
  nominee_accounts: (accounts as any[]).filter((a) => a.year === CUR && !a.platform_id.startsWith("fund_")).length,
  fund_accounts: (accounts as any[]).filter((a) => a.year === CUR && a.platform_id.startsWith("fund_")).length,
  classified_entities: mapping.length,
  direct_vps_persons: personMarket,
  sources: [`aksjereg-${CUR}.parquet`, `aksjereg-${PREV}.parquet`],
  generated_at: new Date().toISOString(),
};
writeFileSync(join(OUT, "stats.json"), JSON.stringify(stats, null, 2));
console.log(JSON.stringify(stats, null, 2));
console.log(`holdings=${holdings.length} profile=${profile.length} accounts=${accounts.length}`);

if (!UPLOAD) {
  console.log("Dry run — pass --upload to load into the database.");
  process.exit(0);
}

// ── 4. Upload ──────────────────────────────────────────────────────────────
const URL_ = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for --upload");
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

async function rest(method: string, path: string, body?: unknown, prefer?: string) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(`${URL_}/rest/v1/${path}`, {
      method,
      headers: { ...headers, ...(prefer ? { Prefer: prefer } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.ok) return res;
    const text = await res.text();
    if (res.status >= 500 && attempt < 4) {
      await new Promise((r) => setTimeout(r, attempt * 1500));
      continue;
    }
    throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 400)}`);
  }
  throw new Error("unreachable");
}

async function insertBatches(table: string, rows: any[], size = 1000, prefer = "return=minimal") {
  for (let i = 0; i < rows.length; i += size) {
    await rest("POST", table, rows.slice(i, i + size), prefer);
  }
  console.log(`✓ ${table}: ${rows.length} rows`);
}

await insertBatches(
  "custody_platforms",
  CUSTODY_PLATFORMS.map((p, i) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    category_label: PLATFORM_CATEGORIES[p.category].label,
    country: p.country,
    is_nominee: PLATFORM_CATEGORIES[p.category].isNominee,
    investor_profile: PLATFORM_CATEGORIES[p.category].investorProfile,
    sort_order: i,
    updated_at: new Date().toISOString(),
  })),
  500,
  "resolution=merge-duplicates,return=minimal",
);

const years = `(${CUR},${PREV})`;
await rest("DELETE", `company_platform_holdings?year=in.${years}`);
await insertBatches("company_platform_holdings", holdings);
await rest("DELETE", `nominee_accounts?year=in.${years}`);
await insertBatches("nominee_accounts", accounts);
await rest("DELETE", `company_platform_profile?orgnr=neq.__none__`);
await insertBatches("company_platform_profile", profile.map((p: any) => ({ ...p, updated_at: new Date().toISOString() })), 500);
await insertBatches(
  "platform_stats",
  [{ year: CUR, stats, updated_at: new Date().toISOString() }],
  1,
  "resolution=merge-duplicates,return=minimal",
);

const refresh = await rest("POST", "rpc/refresh_company_signals", {});
console.log("✓ refresh_company_signals:", await refresh.text());

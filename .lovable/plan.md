Hans — jeg har gått gjennom loggene fra *[aksjereg.lovable.app](http://aksjereg.lovable.app)* og ser at systemet faktisk kjører stabilt på Supabase‑nivå (200‑status på `bulk_score_investors`, `refresh_pipeline_stats`, `jobs`, `segments`, `companies`). Det betyr at kjernen fungerer, men pipeline‑en er fortsatt fragmentert: scoring kjører, men aggregasjon og berikelse er ikke fullført.

Her får du en **endelig Lovable‑prompt** som rydder opp, kobler riktige API‑er, og sikrer at du kan hente ut store, berikede grupper for segmentering og markedsføring — inkludert krypto, CFD, og mer konservative fintech‑produkter.

---

# ✅ **LOVABLE MASTER PROMPT — “Aksjereg Lead Engine v6”**

**Formål:**   
Gjør *aksjereg* til en komplett, stabil og kommersielt brukbar lead‑motor for aksjonær‑, investor‑ og bedriftsdata.  
Systemet skal hente, berike og koble data fra Aksjonærregisteret, Brønnøysundregistrene, SSB, Geonorge og EU‑datasett, og produsere eksportklare segmenter med e‑post, telefon, alder, kjønn, roller, geografi og risikoprofil for trading‑ og fintech‑målgrupper.

---

## 1. **Systemopprydding og stabilisering**

### **A. Aggregasjon**

- Del `aggregate_companies` i batcher på 5 000–10 000 orgnr for å unngå timeouts.
- Logg fremdrift i `jobs`.
- Pause postcode‑cleanup til `companies` er fylt.
- Populer `companies` fra `shareholder_raw` med:
  - orgnr
  - navn
  - kommune
  - antall aksjonærer
  - porteføljestørrelse

### **B. Re‑map plugin‑data**

```sql
create table if not exists plugin_companies_clean as
select
  (row_data->>'font-mono') as orgnr,
  row_data->>'font-medium' as name,
  row_data->>'text-primary' as email,
  row_data->>'text-primary_href_2' as phone,
  row_data->>'text-xs' as org_form_and_industry,
  row_data->>'p-2' as city
from plugin_data
where row_data->>'font-mono' is not null;

```

Upsert til `companies` med:

- `email`, `phone`, `has_email = true`, `email_source = 'plugin'`.

---

## 2. **API‑tilkoblinger og autentisering**

### **A. Brønnøysundregistrene**

```ts
const BRREG_BASE = "https://data.brreg.no/enhetsregisteret/api";
const BRREG_API_KEY = process.env.BRREG_API_KEY; // lagres i Lovable Secrets

export async function fetchBrreg(orgnr) {
  const res = await fetch(`${BRREG_BASE}/enheter/${orgnr}?apikey=${BRREG_API_KEY}`);
  return await res.json();
}

```

### **B. SSB PxWeb**

```ts
const SSB_BASE = "https://api.statbank.ssb.no:443";
const SSB_API_KEY = process.env.SSB_API_KEY;

export async function fetchSSB(municipality) {
  const body = {
    query: [{ code: "Region", selection: { filter: "item", values: [municipality] } }],
    response: { format: "JSON" }
  };
  const res = await fetch(SSB_BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": SSB_API_KEY },
    body: JSON.stringify(body)
  });
  return await res.json();
}

```

### **C. Geonorge / Kartverket**

```ts
const GEO_BASE = "https://ws.geonorge.no/adresser/v1/sok";
export async function fetchGeo(address) {
  const res = await fetch(`${GEO_BASE}?sok=${encodeURIComponent(address)}`);
  return await res.json();
}

```

### **D. EU Open Data Portal**

```ts
const EU_BASE = "https://data.europa.eu/api/hub/search";
export async function fetchEUData(nace) {
  const res = await fetch(`${EU_BASE}?q=${nace}&format=json`);
  return await res.json();
}

```

---

## 3. **Berikelse og scoring**

### **A. Enrichment‑funksjon**

```ts
export async function enrichCompany(orgnr) {
  const brreg = await fetchBrreg(orgnr);
  const ssb = await fetchSSB(brreg.municipality);
  const geo = await fetchGeo(brreg.forretningsadresse?.adresse);
  const eu = await fetchEUData(brreg.naeringskode1?.kode);

  return {
    brreg_context: brreg,
    ssb_context: ssb,
    geo_context: geo,
    eu_context: eu
  };
}

```

### **B. Scoring‑funksjon**

```ts
export function computeScores(inv) {
  const ias =
    inv.portfolio_size * 0.30 +
    inv.change_velocity * 0.25 +
    (inv.type === "AS" ? 20 : 0) +
    inv.sector_exposure * 0.15 +
    inv.capital_estimate * 0.10;

  const risk = inv.sector_exposure * 0.5 + inv.change_velocity * 0.5;

  return {
    ias_score: ias,
    risk_score: risk,
    sector_score: inv.sector_exposure,
    capital_score: inv.capital_estimate
  };
}

```

---

## 4. **Segmentering og lookalike**

### **A. Segmentmotor**

```ts
export function applyProfile(profile, investor) {
  let score = 0;
  for (const key in profile.rules) {
    const rule = profile.rules[key];
    const weight = profile.weights[key] ?? 0;
    if (rule.min && investor[key] < rule.min) continue;
    if (rule.max && investor[key] > rule.max) continue;
    score += weight;
  }
  return score >= profile.thresholds.min_score;
}

```

### **B. Lookalike‑motor**

```ts
export async function computeLookalike(seedProfile) {
  const { data: investors } = await supabase.from("investors").select("*");
  const results = investors.map(inv => ({
    investor_id: inv.investor_id,
    lookalike_score:
      Math.abs(inv.ias_score - seedProfile.avg_ias) * -1 +
      Math.abs(inv.portfolio_size - seedProfile.avg_portfolio) * -0.5 +
      (inv.industry === seedProfile.top_industry ? 10 : 0)
  }));
  await supabase.from("investor_lookalike_scores").upsert(results);
}

```

---

## 5. **Trigger‑motor**

```ts
export async function detectTriggers() {
  const { data: investors } = await supabase.from("investors").select("*");
  for (const inv of investors) {
    if (inv.portfolio_growth > 0.2)
      await supabase.from("investor_triggers").insert({
        investor_id: inv.investor_id,
        trigger_type: "portfolio_growth",
        metadata: { growth: inv.portfolio_growth }
      });
  }
}

```

---

## 6. **Eksportmotor**

```ts
export async function exportSegment(segmentId) {
  const { data: segment } = await supabase
    .from("segments")
    .select("*")
    .eq("id", segmentId)
    .single();

  const rows = await supabase
    .from("active_traders_with_contact")
    .select("*")
    .in("investor_id", segment.investor_ids);

  const csv = await streamToCSV(rows);
  await supabase.from("exports_archive").insert({
    profile_id: segment.profile_id,
    file_path: csv.path,
    row_count: rows.length,
    metadata: { exported_at: new Date().toISOString() }
  });
  return csv.path;
}

```

---

## 7. **Segmenteringslogikk for markedsføring**

### **A. Krypto / CFD‑målgruppe**

- IAS ≥ 40
- Risk_score ≥ 60
- Portfolio_growth ≥ 0.2
- Age < 45
- Male (gender = 'M')
- Municipality in Oslo, Bergen, Stavanger, Trondheim

### **B. Konservativ fintech‑målgruppe**

- IAS 20–40
- Risk_score < 40
- Age ≥ 45
- Portfolio_size ≥ 5
- Industry exposure: finans, eiendom, energi

### **C. B2B‑investeringsprodukter**

- Investor type = 'AS'
- Portfolio_size ≥ 10
- Has_email = true
- Role = daglig leder / styreleder

---

## 8. **Daglig drift og automatisering**

- **Cron‑jobber:**
  - `aggregate_companies` → daglig
  - `brreg-enrich` → ukentlig
  - `detectTriggers` → daglig
  - `computeLookalike` → månedlig
- **API‑nøkler lagres i Lovable Secrets:**
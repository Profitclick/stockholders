# stockholders

✅ LOVABLE MASTER PROMPT — Investor Pattern Studio (IPS) — Full Internal Visibility Edition

Build a fully functional, high‑performance internal platform called “Investor Pattern Studio (IPS)”.  

IPS must support massive datasets, heavy processing, enrichment from multiple APIs, custom investor profiles, segmentation, plugins, and export — and ALL data must remain fully visible internally after export.

---

1. SYSTEM REQUIREMENTS (CRITICAL)

IPS must support:

A. Massive CSV imports

- Files up to 5–20 million rows  

- Streaming CSV parser  

- Chunked ingestion (10k–100k rows per batch)  

- Automatic schema detection  

- Deduplication  

- Error‑tolerant parsing  

B. High‑performance processing

- Asynchronous job queue  

- Background workers  

- Parallel processing  

- Progress tracking  

- Real‑time status updates  

C. Progress bars

Every long‑running task must show:

- % complete  

- estimated time remaining  

- current batch  

- total batches  

- errors/warnings  

D. Large‑scale export

- Export segments as CSV/JSON  

- Streaming export  

- Progress bar for export  

- All exported datasets must be stored internally and visible in an “Exports Archive”  

- Users must be able to re‑open, inspect, filter, and re‑export any past export  

E. Multi‑dataset import

User can upload:

- shareholder CSV  

- price data  

- crypto data  

- CRM lists  

- sector lists  

- demographic datasets  

- custom plugin datasets  

F. Plugin architecture

Plugins must be:

- hot‑swappable  

- able to add new enrichment fields  

- able to add new scoring rules  

- able to add new profile types  

G. Full internal visibility

- All imported data must remain visible  

- All enriched data must remain visible  

- All processed data must remain visible  

- All exports must remain visible  

- No automatic deletion  

- Internal audit log  

---

2. DATA INPUTS

A. Aksjonærregisteret CSV

Fields may include:

- shareholder name  

- shareholder type (person/AS)  

- birth year  

- gender  

- municipality  

- postcode  

- company name  

- orgnr  

- number of shares  

- year  

B. Open APIs

Integrate:

1. Brønnøysundregistrene Enhetsregisteret

Endpoints:

- /enheter/{orgnr}  

- /enheter/lastned  

2. SSB PxWeb API

- municipality‑level income  

- demographics  

- industry stats  

3. Optional future APIs

System must allow adding:

- crypto exchange datasets  

- VPS/Euronext public holdings  

- EU regulatory feeds  

- market price feeds  

---

3. DATA MODEL

investors

`

investor_id UUID

name

type (AS/person)

birth_year

gender

municipality

region

ssb_context JSON

brreg_context JSON

portfolio_size INT

portfolio_companies JSON[]

portfolio_industries JSON[]

yearoveryear_changes JSON

capital_estimate FLOAT

ias_score FLOAT

custom_scores JSON

demographics JSON

`

companies

`

orgnr

name

industry

size

brreg_data JSON

`

profiles

`

profile_id

name

description

rules JSON

weights JSON

thresholds JSON

`

segments

`

segment_id

profile_id

generated_at

investor_ids JSON[]

summary JSON

`

exports_archive

`

export_id

profile_id

generated_at

file_path

row_count

metadata JSON

`

jobs

`

job_id

type

status (queued/running/completed/failed)

progress FLOAT

metadata JSON

created_at

updated_at

`

---

4. SCORING ENGINE

Investor Activity Score (IAS)

(0–100)

- 30% portfolio size  

- 25% year‑over‑year changes  

- 20% entity type  

- 15% industry exposure  

- 10% capital estimate  

---

5. PREBUILT INVESTOR PROFILES

1. Aktiv småsparer / Nordnet‑type

`

Rules:

- portfolio_size 5–25

- small positions (<2%)

- high exposure to tech/energy/finance

- frequent changes

- optional: match crypto plugin

Weights:

portfolio_size: 30

yoy_changes: 30

industry_exposure: 20

ownership_size: 10

volatility_exposure: 10

`

2. Krypto / Høy‑risiko investor

`

Rules:

- high tech/growth exposure

- frequent changes

- small diversified positions

- optional: crypto plugin match

Weights:

industry_exposure: 40

yoy_changes: 30

portfolio_size: 20

volatility_exposure: 10

`

3. Semi‑proff holdingsinvestor

`

Rules:

- investor type = AS

- portfolio_size 10–40

- stable ownership patterns

- multi‑industry exposure

Weights:

entity_type: 40

portfolio_size: 30

industry_diversity: 20

capital_estimate: 10

`

4. Utbyttejeger

`

Rules:

- large positions

- stable companies

- low volatility

- low change frequency

Weights:

ownership_size: 40

industry_stability: 30

low_volatility: 20

lowyoychanges: 10

`

---

6. SQL QUERIES

Aggregate investors

`sql

SELECT 

  shareholder_name,

  COUNT(DISTINCT orgnr) AS portfolio_size,

  ARRAYAGG(DISTINCT orgnr) AS portfoliocompanies

FROM shareholder_raw

GROUP BY shareholder_name;

`

Year‑over‑year changes

`sql

SELECT 

  investor_id,

  COUNT(*) FILTER (WHERE changetype = 'added') AS newpositions,

  COUNT(*) FILTER (WHERE changetype = 'removed') AS soldpositions

FROM portfolio_changes

GROUP BY investor_id;

`

Join with Brreg

`sql

SELECT 

  i.investor_id,

  c.industry,

  c.size

FROM investors i

LEFT JOIN companies c ON c.orgnr = ANY(i.portfolio_companies);

`

---

7. API FUNCTIONS

fetchBrregEntity(orgnr)

fetchSSBContext(municipality)

computeIAS(investor)

applyProfile(profile, investor)

startJob(type, metadata)

updateJobProgress(job_id, progress)

getJobStatus(job_id)

storeExport(profileid, filepath, row_count, metadata)

---

8. UI MOCKUPS

Dashboard

- Upload CSV  

- Job queue  

- Progress bars  

- Dataset stats  

Investors Page

- Table with filters  

- Drill‑down modal  

- Score visualizations  

Profiles Page

- Rule builder  

- Weight sliders  

- Preview matches  

Segments Page

- Export buttons  

- Summary charts  

- Segment history  

Exports Archive Page

- List of all past exports  

- View metadata  

- Re‑open dataset  

- Re‑export  

- Download  

Plugins Page

- Upload plugin datasets  

- Enable/disable plugins  

- Plugin logs  

---

9. PRIVACY

- Internal use only  

- All data visible internally after export  

- No external exposure  

- Anonymization toggle  

- Store only necessary fields  

---

10. GOAL

A high‑performance, scalable, modular, user‑friendly internal platform that:

- handles massive datasets  

- enriches with open APIs  

- computes investor profiles  

- segments investors  

- supports plugins  

- exports results  

- stores all exports internally  

- shows progress bars  

- runs entirely inside Lovable  

Name: Investor Pattern Studio (IPS).

---

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://stockholders.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/1ffb7f25-3cbf-47ed-ade2-a0ba0abc4f4f).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

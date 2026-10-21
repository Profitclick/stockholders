# AGENTS.md

- `src/lib/custodyPlatforms.ts` is the single source of truth for mapping registered shareholder names to custody/broker platforms; the ETL and UI both import it — why: one classifier avoids drift between data load and display.
- Platform exposure is computed offline with DuckDB by `scripts/etl/platform-exposure.ts` and loaded with the service role; platform tables are read-only for the app — why: millions of register rows must not go through the browser, and person-level data must not be publicly writable.
- AI ownership Q&A (`ownership-ask` edge function) only sends the model aggregates built by the admin-gated SQL function `ownership_ai_context`; never pass person-level rows or names to the model — why: privacy, the model cannot leak what it never sees.

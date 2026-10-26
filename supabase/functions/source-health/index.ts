// Live health probe for every external data source the pipeline depends on.
// Keeps the UI honest: nothing silently runs against a dead endpoint.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface Probe {
  id: string;
  label: string;
  url: string;
  method?: "GET" | "HEAD";
  critical: boolean;
}

const PROBES: Probe[] = [
  {
    id: "brreg",
    label: "Brønnøysundregistrene",
    url: "https://data.brreg.no/enhetsregisteret/api/enheter/923609016",
    critical: true,
  },
  {
    id: "allemannsdata",
    label: "Allemannsdata (åpne data)",
    url: "https://allemannsdata.com/wiki/api/v1/kilder/firmafakta/selskapsdetaljer?organization_id=923609016&limit=1",
    critical: true,
  },
  {
    id: "parquet",
    label: "Aksjonærregister (Parquet 2017–2025, prosjektlagring)",
    url: `${Deno.env.get("SUPABASE_URL")}/storage/v1/object/public/shareholders/aksjereg-2025.parquet`,
    method: "HEAD",
    critical: false,
  },
  {
    id: "ssb",
    label: "SSB statistikk",
    url: "https://data.ssb.no/api/v0/no/table/",
    critical: false,
  },
  {
    id: "data_norge",
    label: "data.norge.no",
    url: "https://data.norge.no/api/datasets?size=1",
    critical: false,
  },
];

async function probe(p: Probe) {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const resp = await fetch(p.url, {
      method: p.method ?? "GET",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    const latency = Date.now() - started;
    return {
      id: p.id,
      label: p.label,
      critical: p.critical,
      status: resp.ok ? "ok" : resp.status === 429 ? "throttled" : "degraded",
      http_status: resp.status,
      latency_ms: latency,
    };
  } catch (err) {
    return {
      id: p.id,
      label: p.label,
      critical: p.critical,
      status: "down",
      http_status: 0,
      latency_ms: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const sources = await Promise.all(PROBES.map(probe));
  const criticalDown = sources.some((s) => s.critical && s.status === "down");
  const anyDegraded = sources.some((s) => s.status !== "ok");

  return new Response(
    JSON.stringify({
      overall: criticalDown ? "down" : anyDegraded ? "degraded" : "ok",
      checked_at: new Date().toISOString(),
      sources,
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});

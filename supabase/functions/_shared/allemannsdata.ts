// Shared client for Allemannsdata (read-only Norwegian open data, no auth).
// Docs: https://allemannsdata.com/wiki/api/v1/
// Success payloads live in `data`; errors expose error.retryable.

export const ALLEMANNSDATA_BASE = "https://allemannsdata.com/wiki/api/v1";

export interface AllemannsdataResult<T = unknown> {
  ok: boolean;
  data: T[];
  status: number;
  retryable: boolean;
  error?: string;
  retrievedAt?: string;
}

const DEFAULT_TIMEOUT_MS = 12000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithTimeout(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Call one Allemannsdata source operation.
 * Handles 429/5xx with bounded exponential backoff and never throws.
 */
export async function callAllemannsdata<T = unknown>(
  source: string,
  operation: string,
  params: Record<string, string | number | undefined> = {},
  opts: { retries?: number; timeoutMs?: number } = {},
): Promise<AllemannsdataResult<T>> {
  const retries = opts.retries ?? 2;
  const url = new URL(`${ALLEMANNSDATA_BASE}/kilder/${source}/${operation}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }

  let lastError = "unknown";
  let lastStatus = 0;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await fetchWithTimeout(url.toString(), opts.timeoutMs);
      lastStatus = resp.status;

      if (resp.status === 429 || resp.status >= 500) {
        const retryAfter = Number(resp.headers.get("Retry-After") ?? 0);
        const waitMs = retryAfter > 0 ? Math.min(retryAfter * 1000, 5000) : 400 * 2 ** attempt;
        lastError = `HTTP ${resp.status}`;
        if (attempt < retries) {
          await sleep(waitMs);
          continue;
        }
        return { ok: false, data: [], status: resp.status, retryable: true, error: lastError };
      }

      if (!resp.ok) {
        return { ok: false, data: [], status: resp.status, retryable: false, error: `HTTP ${resp.status}` };
      }

      const json = await resp.json();
      if (json?.error) {
        return {
          ok: false,
          data: [],
          status: resp.status,
          retryable: Boolean(json.error.retryable),
          error: String(json.error.message ?? json.error.code ?? "api_error"),
        };
      }

      const payload = json?.data;
      const rows: T[] = Array.isArray(payload) ? payload : payload ? [payload] : [];
      return {
        ok: true,
        data: rows,
        status: resp.status,
        retryable: false,
        retrievedAt: json?._meta?.retrieved_at,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < retries) await sleep(400 * 2 ** attempt);
    }
  }

  return { ok: false, data: [], status: lastStatus, retryable: true, error: lastError };
}

/** Run tasks with bounded concurrency so we never hammer upstream sources. */
export async function mapWithConcurrency<TIn, TOut>(
  items: TIn[],
  concurrency: number,
  worker: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
  const results: TOut[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

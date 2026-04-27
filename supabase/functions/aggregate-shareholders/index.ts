import { createClient } from "npm:@supabase/supabase-js@2";

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/aggregate-shareholders`;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DEFAULT_INVESTOR_BATCH_SIZE = 100;
const DEFAULT_COMPANY_BATCH_SIZE = 250;
const MAX_RETRY_COUNT = 4;
const RETRY_DELAY_MS = 5000;

type Phase = "investors" | "companies";

type Payload = {
  jobId?: string;
  phase?: Phase;
  afterName?: string | null;
  afterOrgnr?: string | null;
  investorsProcessed?: number;
  companiesProcessed?: number;
  batchSize?: number;
  retryCount?: number;
};

type AggregateResult = {
  processed_count: number;
  last_key: string | null;
  done: boolean;
};

function toAggregateResult(data: unknown): AggregateResult {
  if (typeof data === "string") {
    return JSON.parse(data) as AggregateResult;
  }

  return {
    processed_count: Number((data as Record<string, unknown> | null)?.processed_count ?? 0),
    last_key: ((data as Record<string, unknown> | null)?.last_key as string | null) ?? null,
    done: Boolean((data as Record<string, unknown> | null)?.done ?? false),
  };
}

function getDefaultBatchSize(phase: Phase) {
  return phase === "companies" ? DEFAULT_COMPANY_BATCH_SIZE : DEFAULT_INVESTOR_BATCH_SIZE;
}

function getMinBatchSize(phase: Phase) {
  return phase === "companies" ? 50 : 25;
}

function getNextBatchSize(phase: Phase, currentBatchSize: number) {
  if (phase === "companies") {
    if (currentBatchSize > 250) return 250;
    if (currentBatchSize > 100) return 100;
    return 50;
  }

  if (currentBatchSize > 100) return 100;
  if (currentBatchSize > 50) return 50;
  return 25;
}

function isRetryableAggregationError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("statement timeout") ||
    normalized.includes("schema cache") ||
    normalized.includes("terminating connection") ||
    normalized.includes("connection")
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function invokeNext(payload: Required<Payload>) {
  const response = await fetch(FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Failed to queue next aggregation batch (${response.status}): ${text}`);
  }
}

async function processBatch(payload: Required<Payload>) {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    if (payload.phase === "investors") {
      const { data, error } = await supabase.rpc("aggregate_investors", {
        p_after_name: payload.afterName,
        p_limit: payload.batchSize,
      });

      if (error) throw new Error(`aggregate_investors failed: ${error.message}`);

      const result = toAggregateResult(data);
      const investorsProcessed = payload.investorsProcessed + result.processed_count;

      await supabase
        .from("jobs")
        .update({
          status: result.done ? "running" : "running",
          current_batch: 1,
          total_batches: 2,
          progress: result.done ? 50 : 25,
          metadata: {
            phase: result.done ? "companies" : "investors",
            batch_size: payload.batchSize,
            investors_processed: investorsProcessed,
            companies_processed: payload.companiesProcessed,
            last_investor_name: result.last_key,
          },
        })
        .eq("id", payload.jobId);

      if (result.done) {
        await invokeNext({
          jobId: payload.jobId,
          phase: "companies",
          afterName: payload.afterName,
          afterOrgnr: null,
          investorsProcessed,
          companiesProcessed: payload.companiesProcessed,
          batchSize: DEFAULT_COMPANY_BATCH_SIZE,
          retryCount: 0,
        });
        return;
      }

      await invokeNext({
        jobId: payload.jobId,
        phase: "investors",
        afterName: result.last_key,
        afterOrgnr: payload.afterOrgnr,
        investorsProcessed,
        companiesProcessed: payload.companiesProcessed,
        batchSize: payload.batchSize,
        retryCount: 0,
      });
      return;
    }

    const { data, error } = await supabase.rpc("aggregate_companies", {
      p_after_orgnr: payload.afterOrgnr,
      p_limit: payload.batchSize,
    });

    if (error) throw new Error(`aggregate_companies failed: ${error.message}`);

    const result = toAggregateResult(data);
    const companiesProcessed = payload.companiesProcessed + result.processed_count;

    if (result.done) {
      await supabase
        .from("jobs")
        .update({
          status: "completed",
          current_batch: 2,
          total_batches: 2,
          progress: 100,
          metadata: {
            phase: "completed",
            batch_size: payload.batchSize,
            investors_processed: payload.investorsProcessed,
            companies_processed: companiesProcessed,
            last_company_orgnr: result.last_key,
          },
        })
        .eq("id", payload.jobId);

      await supabase.from("audit_log").insert({
        action: "aggregation_complete",
        entity_type: "job",
        entity_id: payload.jobId,
        details: {
          investors: payload.investorsProcessed,
          companies: companiesProcessed,
        },
      });

      return;
    }

    await supabase
      .from("jobs")
      .update({
        status: "running",
        current_batch: 2,
        total_batches: 2,
        progress: 75,
        metadata: {
          phase: "companies",
          batch_size: payload.batchSize,
          investors_processed: payload.investorsProcessed,
          companies_processed: companiesProcessed,
          last_company_orgnr: result.last_key,
        },
      })
      .eq("id", payload.jobId);

    await invokeNext({
      jobId: payload.jobId,
      phase: "companies",
      afterName: payload.afterName,
      afterOrgnr: result.last_key,
      investorsProcessed: payload.investorsProcessed,
      companiesProcessed,
      batchSize: payload.batchSize,
      retryCount: 0,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown aggregation error";

    const minBatchSize = getMinBatchSize(payload.phase);
    const shouldRetry =
      isRetryableAggregationError(message) &&
      (payload.batchSize > minBatchSize || payload.retryCount < MAX_RETRY_COUNT);

    if (shouldRetry) {
      const nextBatchSize = message.toLowerCase().includes("statement timeout")
        ? getNextBatchSize(payload.phase, payload.batchSize)
        : payload.batchSize;
      const nextRetryCount = nextBatchSize === payload.batchSize ? payload.retryCount + 1 : 0;

      try {
        await supabase
          .from("jobs")
          .update({
            status: "running",
            metadata: {
              phase: payload.phase,
              batch_size: nextBatchSize,
              investors_processed: payload.investorsProcessed,
              companies_processed: payload.companiesProcessed,
              retry_count: nextRetryCount,
              last_error: message,
              last_investor_name: payload.afterName,
              last_company_orgnr: payload.afterOrgnr,
            },
          })
          .eq("id", payload.jobId);

        await sleep(RETRY_DELAY_MS);
        await invokeNext({
          ...payload,
          batchSize: nextBatchSize,
          retryCount: nextRetryCount,
        });
        return;
      } catch (retryError) {
        const retryMessage = retryError instanceof Error ? retryError.message : "Unknown retry error";
        const combinedMessage = `${message}; retry enqueue failed: ${retryMessage}`;

        await supabase
          .from("jobs")
          .update({
            status: "failed",
            metadata: {
              phase: payload.phase,
              batch_size: payload.batchSize,
              investors_processed: payload.investorsProcessed,
              companies_processed: payload.companiesProcessed,
              error: combinedMessage,
              last_investor_name: payload.afterName,
              last_company_orgnr: payload.afterOrgnr,
            },
          })
          .eq("id", payload.jobId);

        await supabase.from("audit_log").insert({
          action: "aggregation_retry_failed",
          entity_type: "job",
          entity_id: payload.jobId,
          details: {
            phase: payload.phase,
            batch_size: payload.batchSize,
            next_batch_size: nextBatchSize,
            retry_count: nextRetryCount,
            error: combinedMessage,
          },
        }).then(() => {}, () => {});

        return;
      }
    }

    await supabase
      .from("jobs")
      .update({
        status: "failed",
        metadata: {
          phase: payload.phase,
          batch_size: payload.batchSize,
          investors_processed: payload.investorsProcessed,
          companies_processed: payload.companiesProcessed,
          error: message,
        },
      })
      .eq("id", payload.jobId);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const body = ((await req.json().catch(() => ({}))) ?? {}) as Payload;

    if (body.jobId && body.phase) {
      EdgeRuntime.waitUntil(
        processBatch({
          jobId: body.jobId,
          phase: body.phase,
          afterName: body.afterName ?? null,
          afterOrgnr: body.afterOrgnr ?? null,
          investorsProcessed: body.investorsProcessed ?? 0,
          companiesProcessed: body.companiesProcessed ?? 0,
          batchSize: body.batchSize ?? getDefaultBatchSize(body.phase),
          retryCount: body.retryCount ?? 0,
        })
      );

      return new Response(JSON.stringify({ ok: true, job_id: body.jobId, phase: body.phase }), {
        status: 202,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: cleanupJob } = await supabase
      .from("jobs")
      .select("id")
      .eq("type", "data_cleanup")
      .in("status", ["queued", "running"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (cleanupJob) {
      return new Response(JSON.stringify({
        error: "Data cleanup is still running. Wait for it to finish before starting aggregation.",
        job_id: cleanupJob.id,
      }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: activeAggregation } = await supabase
      .from("jobs")
      .select("id")
      .eq("type", "aggregation")
      .in("status", ["queued", "running"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (activeAggregation) {
      return new Response(JSON.stringify({ status: "accepted", job_id: activeAggregation.id, existing: true }), {
        status: 202,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .insert({
        type: "aggregation",
        status: "running",
        total_batches: 2,
        current_batch: 0,
        progress: 0,
        metadata: {
          phase: "investors",
          batch_size: DEFAULT_INVESTOR_BATCH_SIZE,
          investors_processed: 0,
          companies_processed: 0,
        },
      })
      .select("id")
      .single();

    if (jobError || !job) {
      return new Response(JSON.stringify({ error: jobError?.message ?? "Failed to create job" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    EdgeRuntime.waitUntil(
      processBatch({
        jobId: job.id,
        phase: "investors",
        afterName: null,
        afterOrgnr: null,
        investorsProcessed: 0,
        companiesProcessed: 0,
        batchSize: DEFAULT_INVESTOR_BATCH_SIZE,
        retryCount: 0,
      })
    );

    return new Response(JSON.stringify({ status: "accepted", job_id: job.id }), {
      status: 202,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown aggregation error";

    return new Response(JSON.stringify({ error: message }), {
      status: isRetryableAggregationError(message) ? 503 : 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

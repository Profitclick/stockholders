import { createClient } from "npm:@supabase/supabase-js@2";

declare const EdgeRuntime: {
  waitUntil(promise: Promise<unknown>): void;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_BATCH_SIZE = 5000;
const MIN_BATCH_SIZE = 1000;
const DEFAULT_MAX_BATCHES = 2;
const MAX_BATCH_RETRIES = 2;
const MAX_REQUEUE_ATTEMPTS = 4;
const RETRY_DELAY_MS = 4000;
const STALE_JOB_THRESHOLD_MS = 5 * 60 * 1000;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/data-cleanup`;
const AGGREGATE_FUNCTION_URL = `${SUPABASE_URL}/functions/v1/aggregate-shareholders`;

type CleanupPayload = {
  iteration?: number;
  jobId?: string;
  startAggregationAfter?: boolean;
  postcodeUpdatedTotal?: number;
  typeCleanedTotal?: number;
  batchSize?: number;
  maxBatches?: number;
  retryCount?: number;
};

type CleanupState = {
  iteration: number;
  jobId: string;
  startAggregationAfter: boolean;
  postcodeUpdatedTotal: number;
  typeCleanedTotal: number;
  batchSize: number;
  maxBatches: number;
  retryCount: number;
};

type CleanupResult = {
  postcode_updated: number;
  type_cleaned: number;
  remaining: number;
  done: boolean;
};

function toCleanupResult(data: unknown): CleanupResult {
  if (typeof data === "string") {
    return JSON.parse(data) as CleanupResult;
  }

  return {
    postcode_updated: Number((data as Record<string, unknown> | null)?.postcode_updated ?? 0),
    type_cleaned: Number((data as Record<string, unknown> | null)?.type_cleaned ?? 0),
    remaining: Number((data as Record<string, unknown> | null)?.remaining ?? 0),
    done: Boolean((data as Record<string, unknown> | null)?.done ?? false),
  };
}

function toNumber(value: unknown, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toBoolean(value: unknown, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    if (value === "true") {
      return true;
    }

    if (value === "false") {
      return false;
    }
  }

  return fallback;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown cleanup error";
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getProgress(iteration: number) {
  return Math.min(95, Math.max(5, iteration * 4));
}

function getNextBatchSize(currentBatchSize: number) {
  if (currentBatchSize <= MIN_BATCH_SIZE) {
    return currentBatchSize;
  }

  if (currentBatchSize > 2500) {
    return 2500;
  }

  return Math.max(MIN_BATCH_SIZE, Math.floor(currentBatchSize / 2));
}

function isRetryableCleanupError(message: string) {
  const normalized = message.toLowerCase();

  return [
    "upstream request timeout",
    "statement timeout",
    "timed out",
    "timeout",
    "schema cache",
    "failed to fetch",
    "status 520",
    "error code 520",
    "web server is returning an unknown error",
    "<!doctype html",
    "canceling statement due to statement timeout",
  ].some((fragment) => normalized.includes(fragment));
}

function normalizePayload(payload: CleanupPayload): CleanupState {
  return {
    iteration: Math.max(1, toNumber(payload.iteration, 1)),
    jobId: payload.jobId ?? "",
    startAggregationAfter: toBoolean(payload.startAggregationAfter, false),
    postcodeUpdatedTotal: Math.max(0, toNumber(payload.postcodeUpdatedTotal, 0)),
    typeCleanedTotal: Math.max(0, toNumber(payload.typeCleanedTotal, 0)),
    batchSize: Math.max(MIN_BATCH_SIZE, toNumber(payload.batchSize, DEFAULT_BATCH_SIZE)),
    maxBatches: Math.max(1, Math.min(DEFAULT_MAX_BATCHES, toNumber(payload.maxBatches, DEFAULT_MAX_BATCHES))),
    retryCount: Math.max(0, toNumber(payload.retryCount, 0)),
  };
}

function buildCleanupMetadata(
  payload: CleanupState,
  postcodeUpdated: number,
  typeCleaned: number,
  extra: Record<string, unknown> = {}
) {
  return {
    phase: "cleanup",
    iteration: payload.iteration,
    batch_size: payload.batchSize,
    max_batches: payload.maxBatches,
    retry_count: payload.retryCount,
    start_aggregation_after: payload.startAggregationAfter,
    postcode_updated: postcodeUpdated,
    type_cleaned: typeCleaned,
    ...extra,
  };
}

async function safeInsertAuditLog(
  supabase: ReturnType<typeof createClient>,
  entry: Record<string, unknown>
) {
  const { error } = await supabase.from("audit_log").insert(entry);

  if (error) {
    console.error(`Failed to write audit log: ${error.message}`);
  }
}

async function safeUpdateJob(
  supabase: ReturnType<typeof createClient>,
  jobId: string,
  values: Record<string, unknown>
) {
  const { error } = await supabase.from("jobs").update(values).eq("id", jobId);

  if (error) {
    console.error(`Failed to update cleanup job ${jobId}: ${error.message}`);
  }
}

async function invokeSelf(payload: CleanupState) {
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
    throw new Error(`Failed to queue next cleanup run (${response.status}): ${text}`);
  }
}

async function invokeAggregation() {
  const response = await fetch(AGGREGATE_FUNCTION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY,
    },
    body: JSON.stringify({}),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Failed to start aggregation: ${text}`);
  }
}

async function processCleanup(payload: CleanupState) {
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  let totalPostcode = payload.postcodeUpdatedTotal;
  let totalType = payload.typeCleanedTotal;
  let currentBatchSize = payload.batchSize;
  let processedAnything = false;

  try {
    await safeUpdateJob(supabase, payload.jobId, {
      status: "running",
      current_batch: payload.iteration,
      total_batches: Math.max(payload.iteration, 1),
      progress: getProgress(payload.iteration),
      metadata: buildCleanupMetadata(payload, totalPostcode, totalType),
    });

    for (let i = 0; i < payload.maxBatches; i++) {
      let result: CleanupResult | null = null;

      for (let attempt = 0; attempt <= MAX_BATCH_RETRIES; attempt++) {
        const { data, error } = await supabase.rpc("cleanup_shareholder_data", {
          p_limit: currentBatchSize,
        });

        if (!error) {
          result = toCleanupResult(data);
          break;
        }

        const message = error.message ?? "Unknown cleanup RPC error";
        const shouldRetry = isRetryableCleanupError(message) && attempt < MAX_BATCH_RETRIES;

        if (!shouldRetry) {
          throw new Error(`Cleanup failed: ${message}`);
        }

        const nextBatchSize = getNextBatchSize(currentBatchSize);
        console.warn(
          `Cleanup batch ${i + 1} retry ${attempt + 1}/${MAX_BATCH_RETRIES}; batch ${currentBatchSize} -> ${nextBatchSize}: ${message}`
        );

        await safeInsertAuditLog(supabase, {
          action: "data_cleanup_retry",
          entity_type: "job",
          entity_id: payload.jobId,
          details: {
            iteration: payload.iteration,
            batch_index: i + 1,
            retry: attempt + 1,
            previous_batch_size: currentBatchSize,
            next_batch_size: nextBatchSize,
            error: message,
          },
        });

        currentBatchSize = nextBatchSize;
        await sleep(RETRY_DELAY_MS);
      }

      if (!result) {
        throw new Error("Cleanup failed without a result");
      }

      const pc = result.postcode_updated;
      const tc = result.type_cleaned;
      totalPostcode += pc;
      totalType += tc;
      processedAnything = processedAnything || pc > 0 || tc > 0;

      console.log(
        `Batch ${i + 1}: pc=${pc}, type=${tc}, done=${result.done}, batch_size=${currentBatchSize}`
      );

      await safeUpdateJob(supabase, payload.jobId, {
        status: "running",
        current_batch: payload.iteration,
        total_batches: Math.max(payload.iteration, 1),
        progress: getProgress(payload.iteration),
        metadata: buildCleanupMetadata(
          { ...payload, batchSize: currentBatchSize },
          totalPostcode,
          totalType,
          {
            last_batch_postcode_updated: pc,
            last_batch_type_cleaned: tc,
            remaining_flag: result.remaining,
          }
        ),
      });

      if (result.done) {
        await safeInsertAuditLog(supabase, {
          action: "data_cleanup_completed",
          entity_type: "job",
          entity_id: payload.jobId,
          details: {
            iteration: payload.iteration,
            total_postcode: totalPostcode,
            total_type: totalType,
          },
        });

        await safeUpdateJob(supabase, payload.jobId, {
          status: "completed",
          current_batch: payload.iteration,
          total_batches: payload.iteration,
          progress: 100,
          metadata: buildCleanupMetadata(
            { ...payload, batchSize: currentBatchSize, retryCount: 0 },
            totalPostcode,
            totalType,
            {
              phase: "completed",
              remaining: result.remaining,
              last_batch_postcode_updated: pc,
              last_batch_type_cleaned: tc,
              aggregation_started: false,
            }
          ),
        });

        if (payload.startAggregationAfter) {
          try {
            await invokeAggregation();

            await safeUpdateJob(supabase, payload.jobId, {
              metadata: buildCleanupMetadata(
                { ...payload, batchSize: currentBatchSize, retryCount: 0 },
                totalPostcode,
                totalType,
                {
                  phase: "completed",
                  remaining: result.remaining,
                  last_batch_postcode_updated: pc,
                  last_batch_type_cleaned: tc,
                  aggregation_started: true,
                }
              ),
            });
          } catch (aggregationError) {
            const aggregationMessage = getErrorMessage(aggregationError);

            await safeUpdateJob(supabase, payload.jobId, {
              metadata: buildCleanupMetadata(
                { ...payload, batchSize: currentBatchSize, retryCount: 0 },
                totalPostcode,
                totalType,
                {
                  phase: "completed",
                  remaining: result.remaining,
                  last_batch_postcode_updated: pc,
                  last_batch_type_cleaned: tc,
                  aggregation_started: false,
                  aggregation_error: aggregationMessage,
                }
              ),
            });

            await safeInsertAuditLog(supabase, {
              action: "data_cleanup_next_step_failed",
              entity_type: "job",
              entity_id: payload.jobId,
              details: { error: aggregationMessage },
            });
          }
        }

        console.log(`Cleanup complete! ${totalPostcode} postcodes, ${totalType} types fixed`);
        return;
      }
    }

    if (!processedAnything) {
      const message = "Cleanup stopped — no rows processed in this invocation";
      console.log(message);

      await safeInsertAuditLog(supabase, {
        action: "data_cleanup_stopped",
        entity_type: "job",
        entity_id: payload.jobId,
        details: { reason: "zero_rows_processed", iteration: payload.iteration },
      });

      await safeUpdateJob(supabase, payload.jobId, {
        status: "failed",
        metadata: buildCleanupMetadata(
          { ...payload, batchSize: currentBatchSize },
          totalPostcode,
          totalType,
          { error: message }
        ),
      });
      return;
    }

    const nextPayload = normalizePayload({
      ...payload,
      iteration: payload.iteration + 1,
      postcodeUpdatedTotal: totalPostcode,
      typeCleanedTotal: totalType,
      batchSize: currentBatchSize,
      maxBatches: payload.maxBatches,
      retryCount: 0,
    });

    console.log(
      `Processed ${totalPostcode - payload.postcodeUpdatedTotal} pc, ${totalType - payload.typeCleanedTotal} type. Chaining iteration ${nextPayload.iteration} with batch size ${currentBatchSize}...`
    );

    await safeUpdateJob(supabase, payload.jobId, {
      status: "running",
      current_batch: payload.iteration,
      total_batches: nextPayload.iteration,
      progress: getProgress(payload.iteration),
      metadata: buildCleanupMetadata(nextPayload, totalPostcode, totalType, {
        last_invocation_postcode_updated: totalPostcode - payload.postcodeUpdatedTotal,
        last_invocation_type_cleaned: totalType - payload.typeCleanedTotal,
      }),
    });

    await invokeSelf(nextPayload);
  } catch (error) {
    let message = getErrorMessage(error);
    const shouldRequeue = isRetryableCleanupError(message) && payload.retryCount < MAX_REQUEUE_ATTEMPTS;

    if (shouldRequeue) {
      const nextPayload = normalizePayload({
        ...payload,
        iteration: payload.iteration + 1,
        postcodeUpdatedTotal: totalPostcode,
        typeCleanedTotal: totalType,
        batchSize: getNextBatchSize(currentBatchSize),
        maxBatches: 1,
        retryCount: payload.retryCount + 1,
      });

      try {
        console.warn(
          `Retryable cleanup error. Requeueing iteration ${nextPayload.iteration} with batch size ${nextPayload.batchSize}: ${message}`
        );

        await safeInsertAuditLog(supabase, {
          action: "data_cleanup_requeued",
          entity_type: "job",
          entity_id: payload.jobId,
          details: {
            iteration: payload.iteration,
            next_iteration: nextPayload.iteration,
            retry_count: nextPayload.retryCount,
            next_batch_size: nextPayload.batchSize,
            error: message,
            total_postcode: totalPostcode,
            total_type: totalType,
          },
        });

        await safeUpdateJob(supabase, payload.jobId, {
          status: "running",
          current_batch: payload.iteration,
          total_batches: nextPayload.iteration,
          progress: getProgress(payload.iteration),
          metadata: buildCleanupMetadata(nextPayload, totalPostcode, totalType, {
            last_error: message,
            resumed_after_error: true,
          }),
        });

        await invokeSelf(nextPayload);
        return;
      } catch (requeueError) {
        message = `${message} | Requeue failed: ${getErrorMessage(requeueError)}`;
      }
    }

    console.error(message);

    await safeInsertAuditLog(supabase, {
      action: "data_cleanup_error",
      entity_type: "job",
      entity_id: payload.jobId,
      details: {
        iteration: payload.iteration,
        error: message,
        total_postcode: totalPostcode,
        total_type: totalType,
      },
    });

    await safeUpdateJob(supabase, payload.jobId, {
      status: "failed",
      metadata: buildCleanupMetadata(
        { ...payload, batchSize: currentBatchSize },
        totalPostcode,
        totalType,
        { error: message }
      ),
    });
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
    const body = ((await req.json().catch(() => ({}))) ?? {}) as CleanupPayload;

    if (body.jobId) {
      const chainedPayload = normalizePayload({
        jobId: body.jobId,
        iteration: body.iteration,
        startAggregationAfter: body.startAggregationAfter,
        postcodeUpdatedTotal: body.postcodeUpdatedTotal,
        typeCleanedTotal: body.typeCleanedTotal,
        batchSize: body.batchSize,
        maxBatches: body.maxBatches,
        retryCount: body.retryCount,
      });

      EdgeRuntime.waitUntil(processCleanup(chainedPayload));

      return new Response(JSON.stringify({
        status: "processing",
        iteration: chainedPayload.iteration,
        job_id: chainedPayload.jobId,
        message: `Cleanup continued (${chainedPayload.batchSize} rows × ${chainedPayload.maxBatches} batches per invocation).`,
      }), {
        status: 202,
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
      return new Response(JSON.stringify({
        error: "Aggregation is still running. Wait for it to finish before starting cleanup.",
        job_id: activeAggregation.id,
      }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: activeCleanup } = await supabase
      .from("jobs")
      .select("id, metadata, updated_at")
      .eq("type", "data_cleanup")
      .in("status", ["queued", "running"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (activeCleanup) {
      const metadata = (activeCleanup.metadata as Record<string, unknown> | null) ?? {};
      const updatedAtMs = Date.parse(activeCleanup.updated_at ?? "");
      const isStale = Number.isFinite(updatedAtMs) && Date.now() - updatedAtMs > STALE_JOB_THRESHOLD_MS;

      if (isStale) {
        const resumedPayload = normalizePayload({
          jobId: activeCleanup.id,
          iteration: toNumber(metadata.iteration, 1),
          startAggregationAfter:
            body.startAggregationAfter ?? toBoolean(metadata.start_aggregation_after, false),
          postcodeUpdatedTotal: toNumber(metadata.postcode_updated, 0),
          typeCleanedTotal: toNumber(metadata.type_cleaned, 0),
          batchSize: Math.min(DEFAULT_BATCH_SIZE, toNumber(metadata.batch_size, DEFAULT_BATCH_SIZE)),
          maxBatches: 1,
          retryCount: 0,
        });

        await safeInsertAuditLog(supabase, {
          action: "data_cleanup_resumed",
          entity_type: "job",
          entity_id: activeCleanup.id,
          details: {
            previous_updated_at: activeCleanup.updated_at,
            resumed_batch_size: resumedPayload.batchSize,
            resumed_iteration: resumedPayload.iteration,
          },
        });

        await safeUpdateJob(supabase, activeCleanup.id, {
          status: "running",
          current_batch: resumedPayload.iteration,
          total_batches: Math.max(resumedPayload.iteration, 1),
          progress: getProgress(resumedPayload.iteration),
          metadata: buildCleanupMetadata(
            resumedPayload,
            resumedPayload.postcodeUpdatedTotal,
            resumedPayload.typeCleanedTotal,
            {
              resumed_from_stale: true,
              previous_updated_at: activeCleanup.updated_at,
            }
          ),
        });

        EdgeRuntime.waitUntil(processCleanup(resumedPayload));

        return new Response(JSON.stringify({
          status: "resuming",
          iteration: resumedPayload.iteration,
          job_id: activeCleanup.id,
          message: `Resuming stale cleanup job (${resumedPayload.batchSize} rows × ${resumedPayload.maxBatches} batch per invocation).`,
        }), {
          status: 202,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (body.startAggregationAfter && !metadata.start_aggregation_after) {
        await safeUpdateJob(supabase, activeCleanup.id, {
          metadata: { ...metadata, start_aggregation_after: true },
        });
      }

      return new Response(JSON.stringify({
        status: "already_running",
        iteration: Number(metadata.iteration ?? 1),
        job_id: activeCleanup.id,
        message: "Cleanup is already running.",
      }), {
        status: 202,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const initialPayload = normalizePayload({
      iteration: 1,
      startAggregationAfter: body.startAggregationAfter ?? false,
      postcodeUpdatedTotal: 0,
      typeCleanedTotal: 0,
      batchSize: DEFAULT_BATCH_SIZE,
      maxBatches: DEFAULT_MAX_BATCHES,
      retryCount: 0,
    });

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .insert({
        type: "data_cleanup",
        status: "running",
        total_batches: 1,
        current_batch: 0,
        progress: 0,
        metadata: buildCleanupMetadata(initialPayload, 0, 0),
      })
      .select("id")
      .single();

    if (jobError || !job) {
      return new Response(JSON.stringify({ error: jobError?.message ?? "Failed to create cleanup job" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const queuedPayload = normalizePayload({
      ...initialPayload,
      jobId: job.id,
    });

    EdgeRuntime.waitUntil(processCleanup(queuedPayload));

    return new Response(JSON.stringify({
      status: "processing",
      iteration: 1,
      job_id: job.id,
      message: `Cleanup started (${queuedPayload.batchSize} rows × ${queuedPayload.maxBatches} batches per invocation).`,
    }), {
      status: 202,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = getErrorMessage(error);

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
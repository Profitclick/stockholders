import { streamResponse, type OpenAIResponsesFields } from "npm:@lovable.dev/ai-gateway@0.1.11";
import { getLovableAiGatewayRunId } from "./run-id.ts";

export const OWNERSHIP_MODEL = "openai/gpt-5.4-mini";

export function ownershipSummaryPayload(input: string, instructions?: string) {
  return {
    model: OWNERSHIP_MODEL,
    input,
    ...(instructions ? { instructions } : {}),
    // Summarize database aggregates without a paid reasoning phase or summary.
    reasoning: { effort: "none" },
  } satisfies OpenAIResponsesFields & { model: typeof OWNERSHIP_MODEL };
}

export async function createResponsesCall(
  request: Request,
  input: string,
  instructions?: string,
) {
  return streamResponse(ownershipSummaryPayload(input, instructions), {
    signal: request.signal,
    runId: getLovableAiGatewayRunId(request),
  });
}

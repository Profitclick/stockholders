import { describe, expect, it, vi } from "vitest";

vi.mock("npm:@lovable.dev/ai-gateway@0.1.11", () => ({ streamResponse: vi.fn() }));
import { streamResponse } from "npm:@lovable.dev/ai-gateway@0.1.11";
import { createResponsesCall, ownershipSummaryPayload } from "../../supabase/functions/_shared/responses";

describe("ownership summary costs", () => {
  it("uses the approved lower-cost model", () => {
    expect(ownershipSummaryPayload("{}").model).toBe("openai/gpt-5.4-mini");
  });

  it("disables reasoning for aggregate summaries without requesting reasoning output", () => {
    const payload = ownershipSummaryPayload("{}");
    expect(payload.reasoning).toEqual({ effort: "none" });
    expect(payload).not.toHaveProperty("include");
  });

  it("preserves the input, instructions, cancellation and run correlation", async () => {
    const request = new Request("https://example.test", { headers: { "X-Lovable-AIG-Run-ID": "summary-test" } });
    await createResponsesCall(request, '{"company_count":42}', "Only use these aggregates");
    expect(streamResponse).toHaveBeenCalledWith({
      model: "openai/gpt-5.4-mini", input: '{"company_count":42}',
      instructions: "Only use these aggregates", reasoning: { effort: "none" },
    }, { signal: request.signal, runId: "summary-test" });
  });
});
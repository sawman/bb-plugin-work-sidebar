import { describe, expect, it } from "vitest";
import { rpcSchemas } from "../contracts.schemas";

describe("Work outcome RPC schema", () => {
  it("requires the legacy discovery context on every response", () => {
    const result = rpcSchemas.getWorkOutcome.output.safeParse({
      tasksAvailable: true,
      outcome: null,
      executionTasks: [],
      bindings: [],
    });

    expect(result.success).toBe(false);
  });
});

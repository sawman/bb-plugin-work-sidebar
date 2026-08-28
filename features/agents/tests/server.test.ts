import { describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../../../server";

describe("Agents server projection", () => {
  it("resolves current models in parallel through the official thread execution-options SDK", async () => {
    const defaultExecutionOptions = vi.fn(async ({ threadId }: { threadId: string }) =>
      threadId === "thr_luna"
        ? {
            model: "gpt-5.6-luna",
            permissionMode: "auto" as const,
            reasoningLevel: "medium" as const,
            serviceTier: "fast" as const,
            source: "client/turn/start" as const,
          }
        : null,
    );
    const host = createFakePluginHost({
      sdk: { threads: { defaultExecutionOptions } },
    });
    await plugin(host.bb);

    await expect(host.harness.behavior.callRpc("getAgentDetails", {
      threadIds: ["thr_luna", "thr_unstarted"],
    })).resolves.toEqual({
      agents: [
        { threadId: "thr_luna", model: "gpt-5.6-luna" },
        { threadId: "thr_unstarted", model: null },
      ],
    });
    expect(defaultExecutionOptions.mock.calls.map(([input]) => input)).toEqual([
      { threadId: "thr_luna" },
      { threadId: "thr_unstarted" },
    ]);
    await host.harness.lifecycle.dispose();
  });

  it("rejects duplicate or surplus thread ids before invoking the SDK", async () => {
    const defaultExecutionOptions = vi.fn();
    const host = createFakePluginHost({
      sdk: { threads: { defaultExecutionOptions } },
    });
    await plugin(host.bb);

    await expect(host.harness.behavior.callRpc("getAgentDetails", {
      threadIds: ["thr_same", "thr_same"],
    })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(host.harness.behavior.callRpc("getAgentDetails", {
      threadIds: [],
      surplus: true,
    } as never)).rejects.toMatchObject({ code: "invalid_input" });
    expect(defaultExecutionOptions).not.toHaveBeenCalled();
    await host.harness.lifecycle.dispose();
  });
});

import { describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { createProviderRetryRegistration } from "../../features/threads/provider-retry-server";

const retry = {
  id: "queued_retry",
  threadId: "thr_retry",
  reason: "Rate limited",
  attempt: 2,
  sendAt: 1_800_000_065_000,
};

describe("provider retry server registration", () => {
  it("projects only retry queue rows and publishes retry lifecycle changes", async () => {
    const queueList = vi.fn(async () => [
      {
        ...retry,
        payload: { kind: "retry", reason: retry.reason, attempt: retry.attempt },
        failureReason: null,
      },
      {
        id: "ordinary",
        threadId: "thr_other",
        payload: { kind: "inline" },
        sendAt: null,
        failureReason: null,
      },
    ]);
    const host = createFakePluginHost({
      sdk: { threads: { queue: { list: queueList } } },
    } as never);
    const handlers = createProviderRetryRegistration(host.bb);

    await expect(handlers.sidebarProviderRetries(null)).resolves.toEqual({
      retries: [retry],
    });
    expect(queueList).toHaveBeenCalledWith();
    await host.harness.behavior.emitThreadEvent("message.queued", {
      entry: {
        ...retry,
        payload: { kind: "retry", reason: retry.reason, attempt: retry.attempt },
      },
    } as never);
    await host.harness.behavior.emitThreadEvent("message.dispatched", {
      entry: { id: "ordinary", threadId: "thr_other", payload: { kind: "inline" } },
    } as never);
    expect(host.harness.inspection.realtimeSignals).toEqual([
      { channel: "work-sidebar:changed", payload: { family: "provider-retry", threadId: "thr_retry" } },
    ]);
    await host.harness.lifecycle.dispose();
  });
});

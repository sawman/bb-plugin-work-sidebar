import { describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { createQueuedMessageRegistration } from "../../features/threads/queued-messages-server";

const retry = {
  id: "queued_retry",
  threadId: "thr_retry",
  reason: "Rate limited",
  attempt: 2,
  sendAt: 1_800_000_065_000,
};

describe("queued message server registration", () => {
  it("groups all queued rows and publishes their lifecycle changes", async () => {
    const queueList = vi.fn(async () => [
      {
        ...retry,
        payload: { kind: "retry", reason: retry.reason, attempt: retry.attempt },
        failureReason: null,
        waitingOn: { kind: "time" },
      },
      {
        id: "ordinary",
        threadId: "thr_other",
        payload: { kind: "inline" },
        sendAt: null,
        failureReason: null,
        waitingOn: { kind: "provisioning" },
      },
      {
        id: "ordinary_second",
        threadId: retry.threadId,
        payload: { kind: "inline" },
        sendAt: 1_800_000_066_000,
        failureReason: null,
        waitingOn: { kind: "thread-busy" },
      },
    ]);
    const host = createFakePluginHost({
      sdk: { threads: { queue: { list: queueList } } },
    } as never);
    const handlers = createQueuedMessageRegistration(host.bb);

    await expect(handlers.sidebarQueuedMessages(null)).resolves.toEqual({
      messages: [
        {
          threadId: retry.threadId,
          count: 2,
          nextSendAt: retry.sendAt,
          waitingLabel: "Retry: Rate limited",
          retryReason: "Rate limited",
        },
        {
          threadId: "thr_other",
          count: 1,
          nextSendAt: null,
          waitingLabel: "Provisioning environment",
          retryReason: null,
        },
      ],
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
      { channel: "work-sidebar:changed", payload: { family: "queued-message", threadId: "thr_retry" } },
      { channel: "work-sidebar:changed", payload: { family: "queued-message", threadId: "thr_other" } },
    ]);
    await host.harness.lifecycle.dispose();
  });
});

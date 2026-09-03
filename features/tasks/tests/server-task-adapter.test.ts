import {
  createFakePluginHost,
  type FakeSdkOverrides,
} from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import { createTasksPluginAdapter } from "../server-task-adapter";

const PROJECT_ID = "01M110X2HHBYGSGJAB5ZBW382N";
const TASK_IDS = {
  removed: "01M1P000000000000000000001",
  first: "01M1P000000000000000000002",
  second: "01M1P000000000000000000003",
  third: "01M1P000000000000000000004",
} as const;
const STALE_CURSOR_MESSAGE =
  "task-list data changed after this cursor was issued; restart pagination without --cursor";
type FakePluginsSdk = NonNullable<FakeSdkOverrides["plugins"]>;
type FakeCallRpc = NonNullable<FakePluginsSdk["callRpc"]>;

function task(id: string, title: string) {
  return {
    id,
    projectId: PROJECT_ID,
    number: Number(id.at(-1)),
    key: `BBPLUG-${id.at(-1)}`,
    title,
    description: "",
    status: "todo" as const,
    priority: "medium" as const,
    dueDate: null,
    parentTaskId: null,
    position: Number(id.at(-1)),
    createdAt: "2026-09-04T00:00:00.000Z",
    updatedAt: "2026-09-04T00:00:00.000Z",
    labelIds: [],
  };
}

function staleCursorError() {
  return Object.assign(new Error(`HTTP 500: ${STALE_CURSOR_MESSAGE}`), {
    name: "BbHttpError",
    code: "handler_error",
    status: 500,
    body: {
      ok: false,
      error: { code: "handler_error", message: STALE_CURSOR_MESSAGE },
    },
  });
}

function fixture(
  callRpc: FakeCallRpc,
) {
  const host = createFakePluginHost({
    sdk: { plugins: { callRpc } },
  });
  return {
    adapter: createTasksPluginAdapter(host.bb),
    dispose: () => host.harness.lifecycle.dispose(),
  };
}

describe("Tasks adapter pagination", () => {
  it("restarts once after a later-page invalidation and returns one complete deduplicated snapshot", async () => {
    const callRpc = vi.fn<FakeCallRpc>()
      .mockResolvedValueOnce({
        tasks: [task(TASK_IDS.removed, "Removed during pagination"), task(TASK_IDS.first, "Old first")],
        nextCursor: "stale-page-2",
      })
      .mockRejectedValueOnce(staleCursorError())
      .mockResolvedValueOnce({
        tasks: [task(TASK_IDS.first, "Fresh first"), task(TASK_IDS.second, "Second")],
        nextCursor: "fresh-page-2",
      })
      .mockResolvedValueOnce({
        tasks: [task(TASK_IDS.second, "Second, refreshed duplicate"), task(TASK_IDS.third, "Third")],
        nextCursor: null,
      });
    const { adapter, dispose } = fixture(callRpc);

    try {
      const result = await adapter.listAll({ activeOnly: false, sort: "manual" });

      expect(result.map(({ id, title }) => ({ id, title }))).toEqual([
        { id: TASK_IDS.first, title: "Fresh first" },
        { id: TASK_IDS.second, title: "Second, refreshed duplicate" },
        { id: TASK_IDS.third, title: "Third" },
      ]);
      expect(callRpc.mock.calls.map(([input]) => input.input)).toEqual([
        { activeOnly: false, sort: "manual", limit: 500 },
        { activeOnly: false, sort: "manual", limit: 500, cursor: "stale-page-2" },
        { activeOnly: false, sort: "manual", limit: 500 },
        { activeOnly: false, sort: "manual", limit: 500, cursor: "fresh-page-2" },
      ]);
    } finally {
      await dispose();
    }
  });

  it("rejects repeated invalidation after the single restart", async () => {
    const repeatedInvalidation = staleCursorError();
    const callRpc = vi.fn<FakeCallRpc>()
      .mockResolvedValueOnce({
        tasks: [task(TASK_IDS.first, "First")],
        nextCursor: "stale-page-2",
      })
      .mockRejectedValueOnce(staleCursorError())
      .mockResolvedValueOnce({
        tasks: [task(TASK_IDS.first, "Fresh first")],
        nextCursor: "stale-again-page-2",
      })
      .mockRejectedValueOnce(repeatedInvalidation);
    const { adapter, dispose } = fixture(callRpc);

    try {
      await expect(
        adapter.listAll({ activeOnly: true, sort: "priority" }),
      ).rejects.toBe(repeatedInvalidation);
      expect(callRpc).toHaveBeenCalledTimes(4);
    } finally {
      await dispose();
    }
  });

  it("passes unrelated pagination errors through without restarting", async () => {
    const unrelatedError = new Error("Tasks RPC unavailable");
    const callRpc = vi.fn<FakeCallRpc>()
      .mockResolvedValueOnce({
        tasks: [task(TASK_IDS.first, "First")],
        nextCursor: "page-2",
      })
      .mockRejectedValueOnce(unrelatedError);
    const { adapter, dispose } = fixture(callRpc);

    try {
      await expect(
        adapter.listAll({ activeOnly: false, sort: "due" }),
      ).rejects.toBe(unrelatedError);
      expect(callRpc).toHaveBeenCalledTimes(2);
    } finally {
      await dispose();
    }
  });
});

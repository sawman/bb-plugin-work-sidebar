import { describe, expect, it, vi } from "vitest";
import { createTrackerService } from "../server";
import { taskboardItemSchema } from "../schemas";

const item = {
  bbProjectId: "proj_1",
  source: "linear" as const,
  locator: "issue-1",
  key: "LIN-1",
  title: "Tracker work",
  description: "",
  url: "https://linear.app/issue/LIN-1",
  status: "Todo",
  stateCategory: "todo" as const,
  priority: null,
  assignee: null,
  project: null,
  labels: [],
  updatedAt: "2026-01-01",
};
const secondItem = {
  ...item,
  locator: "issue-2",
  key: "LIN-2",
  title: "Second tracker work",
  url: "https://linear.app/issue/LIN-2",
};
function setup(call = vi.fn(), initialStorage: unknown = {}) {
  let v2: unknown = undefined;
  const publish = vi.fn();
  const setStorage = vi.fn(async (value) => {
    v2 = value;
  });
  return {
    call,
    publish,
    setStorage,
    service: createTrackerService({
      call: call as never,
      getStorage: async (key) =>
        key === "work-linear-links:v2" ? v2 : initialStorage,
      setStorage,
      rootThread: async () => ({ id: "thr_root", projectId: "proj_1" }),
      threadTitle: async () => "Tracker work",
      publish,
    }),
  };
}

describe("Taskboard tracker adapter", () => {
  it("rejects unknown fields at the strict Taskboard wire boundary", () => {
    expect(() =>
      taskboardItemSchema.parse({ ...item, unexpected: true }),
    ).toThrow();
  });
  it("uses exact validated Taskboard calls and falls back from a title miss to recent issues", async () => {
    const { call, service } = setup(
      vi
        .fn()
        .mockResolvedValueOnce({ items: [] })
        .mockResolvedValueOnce({ items: [item] }),
    );
    await expect(service.context("thr_child")).resolves.toMatchObject({
      visible: true,
      available: true,
      suggestions: [{ key: "LIN-1" }],
    });
    expect(call.mock.calls.map(([method, input]) => [method, input])).toEqual([
      [
        "listItems",
        {
          projectId: "proj_1",
          source: "linear",
          query: "Tracker work",
          limit: 8,
        },
      ],
      [
        "listItems",
        { projectId: "proj_1", source: "linear", query: "", limit: 8 },
      ],
    ]);
  });

  it("projects Taskboard data to the public RPC shape and bounds unavailable or malformed payloads", async () => {
    const hit = setup(vi.fn().mockResolvedValue({ items: [item] }));
    const context = await hit.service.context("thr_child");
    expect(context.suggestions).toEqual([
      { key: "LIN-1", title: "Tracker work", url: item.url },
    ]);
    expect(context.items).toEqual([]);
    const unavailable = setup(
      vi.fn().mockRejectedValue(new Error("Taskboard plugin is not installed")),
    );
    await expect(
      unavailable.service.context("thr_child"),
    ).resolves.toMatchObject({
      visible: true,
      available: false,
      message:
        "Linear integration is unavailable because the optional Taskboard plugin is not installed.",
    });
    const nonLinear = setup(
      vi
        .fn()
        .mockRejectedValue(new Error("Linear is not the selected tracker")),
    );
    await expect(nonLinear.service.context("thr_child")).resolves.toMatchObject(
      { visible: false, available: false },
    );
    const malformed = setup(
      vi
        .fn()
        .mockImplementation(async (_m, _i, schema) =>
          schema.parse({ items: [{ key: "bad" }] }),
        ),
    );
    await expect(malformed.service.context("thr_child")).resolves.toMatchObject(
      { available: false },
    );
  });

  it("searches, links, unlinks, and changes status through the root link with exact inputs", async () => {
    const call = vi.fn(async (method: string) =>
      method === "updateItemStatus"
        ? { item: { ...item, status: "Done", stateCategory: "done" } }
        : { items: [item] },
    );
    const { publish, setStorage, service } = setup(call);
    await expect(service.search("thr_child", "LIN")).resolves.toEqual({
      items: [{ key: "LIN-1", title: "Tracker work", url: item.url }],
    });
    await expect(service.link("thr_child", "lin-1")).resolves.toEqual({
      key: "LIN-1",
      title: "Tracker work",
    });
    expect(setStorage).toHaveBeenLastCalledWith({
      thr_root: {
        keys: [{ projectId: "proj_1", locator: "issue-1", key: "LIN-1" }],
        primaryKey: "LIN-1",
      },
    });
    expect(publish).toHaveBeenLastCalledWith("thr_root");
    await expect(
      service.updateStatus("thr_child", "LIN-1", "done"),
    ).resolves.toEqual({ key: "LIN-1", status: "Done" });
    expect(call).toHaveBeenCalledWith(
      "updateItemStatus",
      {
        projectId: "proj_1",
        source: "linear",
        locator: "issue-1",
        statusId: "done",
      },
      expect.anything(),
    );
    await service.unlink("thr_child", "LIN-1");
    expect(setStorage).toHaveBeenLastCalledWith({});
    await expect(
      service.updateStatus("thr_child", "LIN-1", "done"),
    ).rejects.toThrow("LIN-1 is not linked");
    expect(call).toHaveBeenCalledWith(
      "listItems",
      { projectId: "proj_1", source: "linear", query: "LIN", limit: 20 },
      expect.anything(),
    );
  });

  it("reads a stored root link with exact item and status calls while stripping Taskboard-only fields", async () => {
    const call = vi.fn(async (method: string) =>
      method === "getItem"
        ? { item: { ...item, comments: [] } }
        : method === "statusOptions"
          ? {
              options: [
                {
                  id: "todo",
                  name: "Todo",
                  stateCategory: "todo",
                  current: true,
                },
              ],
            }
          : { items: [item] },
    );
    const { service } = setup(call, {
      thr_root: { projectId: "proj_1", locator: "issue-1", key: "LIN-1" },
    });
    const context = await service.context("thr_child");
    expect(context.items).toEqual([
      {
        item: {
          key: "LIN-1",
          title: "Tracker work",
          url: item.url,
          status: "Todo",
          stateCategory: "todo",
          priority: null,
          assignee: null,
          project: null,
        },
        statusOptions: [{ id: "todo", name: "Todo", current: true }],
      },
    ]);
    expect(call).toHaveBeenCalledWith(
      "getItem",
      { projectId: "proj_1", source: "linear", locator: "issue-1" },
      expect.anything(),
    );
    expect(call).toHaveBeenCalledWith(
      "statusOptions",
      { projectId: "proj_1", source: "linear", locator: "issue-1" },
      expect.anything(),
    );
  });

  it("refreshes one cold project cache and retries linked reads without user action", async () => {
    const coldReads = new Set(["getItem", "statusOptions"]);
    const call = vi.fn(async (method: string) => {
      if (coldReads.delete(method))
        throw new Error(
          "Linear item is not cached for this BB project; refresh the project tracker first",
        );
      if (method === "refresh")
        return {
          sources: [
            {
              source: "linear",
              configured: true,
              available: true,
              message: null,
              lastSyncedAt: "2026-08-31T00:00:00.000Z",
              itemCount: 1,
            },
          ],
          itemCount: 1,
        };
      if (method === "getItem") return { item: { ...item, comments: [] } };
      if (method === "statusOptions")
        return {
          options: [
            { id: "todo", name: "Todo", stateCategory: "todo", current: true },
          ],
        };
      return { items: [item] };
    });
    const { service } = setup(call, {
      thr_root: { projectId: "proj_1", locator: "issue-1", key: "LIN-1" },
    });

    await expect(service.context("thr_child")).resolves.toMatchObject({
      available: true,
      items: [{ item: { key: "LIN-1" } }],
    });
    expect(call.mock.calls.filter(([method]) => method === "refresh")).toEqual([
      ["refresh", { projectId: "proj_1", source: "linear" }, expect.anything()],
    ]);
    expect(
      call.mock.calls.filter(([method]) => method === "getItem"),
    ).toHaveLength(2);
    expect(
      call.mock.calls.filter(([method]) => method === "statusOptions"),
    ).toHaveLength(2);
  });

  it("retries a cold status mutation once and does not refresh unrelated failures", async () => {
    let cold = true;
    const call = vi.fn(async (method: string) => {
      if (method === "updateItemStatus" && cold) {
        cold = false;
        throw new Error(
          "Linear item is not cached for this BB project; refresh the project tracker first",
        );
      }
      if (method === "refresh") return { sources: [], itemCount: 1 };
      if (method === "updateItemStatus")
        return { item: { ...item, status: "Done", stateCategory: "done" } };
      return { items: [item] };
    });
    const { service } = setup(call, {
      thr_root: { projectId: "proj_1", locator: "issue-1", key: "LIN-1" },
    });

    await expect(
      service.updateStatus("thr_child", "LIN-1", "done"),
    ).resolves.toEqual({ key: "LIN-1", status: "Done" });
    expect(call.mock.calls.map(([method]) => method)).toEqual([
      "updateItemStatus",
      "refresh",
      "updateItemStatus",
    ]);

    call.mockRejectedValueOnce(new Error("Linear is unavailable"));
    await expect(
      service.updateStatus("thr_child", "LIN-1", "done"),
    ).rejects.toThrow("Linear is unavailable");
    expect(
      call.mock.calls.filter(([method]) => method === "refresh"),
    ).toHaveLength(1);
  });

  it("keeps multiple root links and targets status and unlink mutations by issue key", async () => {
    const call = vi.fn(
      async (method: string, input: Record<string, unknown>) => {
        const linkedItem =
          input.locator === "issue-2" || input.query === "LIN-2"
            ? secondItem
            : item;
        if (method === "getItem")
          return { item: { ...linkedItem, comments: [] } };
        if (method === "statusOptions")
          return {
            options: [
              {
                id: "todo",
                name: "Todo",
                stateCategory: "todo",
                current: true,
              },
            ],
          };
        if (method === "updateItemStatus")
          return {
            item: { ...linkedItem, status: "Done", stateCategory: "done" },
          };
        return { items: [linkedItem] };
      },
    );
    const { publish, setStorage, service } = setup(call);

    await service.link("thr_child", "LIN-1");
    await service.link("thr_child", "LIN-2");
    await service.link("thr_child", "LIN-1");

    expect(setStorage).toHaveBeenLastCalledWith({
      thr_root: {
        keys: [
          { projectId: "proj_1", locator: "issue-1", key: "LIN-1" },
          { projectId: "proj_1", locator: "issue-2", key: "LIN-2" },
        ],
        primaryKey: "LIN-1",
      },
    });
    expect(setStorage).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledTimes(2);
    await expect(service.context("thr_child")).resolves.toMatchObject({
      items: [{ item: { key: "LIN-1" } }, { item: { key: "LIN-2" } }],
    });

    await expect(
      service.updateStatus("thr_child", "LIN-2", "done"),
    ).resolves.toEqual({ key: "LIN-2", status: "Done" });
    expect(call).toHaveBeenCalledWith(
      "updateItemStatus",
      expect.objectContaining({ locator: "issue-2", statusId: "done" }),
      expect.anything(),
    );

    await service.unlink("thr_child", "LIN-1");
    expect(setStorage).toHaveBeenLastCalledWith({
      thr_root: {
        keys: [{ projectId: "proj_1", locator: "issue-2", key: "LIN-2" }],
        primaryKey: "LIN-2",
      },
    });
    expect(publish).toHaveBeenCalledTimes(4);
  });

  it("reads v1 links forward, preserves their order, and writes the selected primary into v2", async () => {
    const v1 = {
      thr_root: [
        { projectId: "proj_1", locator: "issue-1", key: "LIN-1" },
        { projectId: "proj_1", locator: "issue-2", key: "LIN-2" },
      ],
    };
    let v2: unknown = undefined;
    const getStorage = vi.fn(async (key?: string) =>
      key === "work-linear-links:v2" ? v2 : v1,
    );
    const setStorage = vi.fn(async (value: unknown) => {
      v2 = value;
    });
    const call = vi.fn(
      async (method: string, input: Record<string, unknown>) => {
        const linked = input.locator === "issue-2" ? secondItem : item;
        if (method === "getItem") return { item: { ...linked, comments: [] } };
        if (method === "statusOptions")
          return {
            options: [
              {
                id: "todo",
                name: "Todo",
                stateCategory: "todo",
                current: true,
              },
            ],
          };
        return { items: [item, secondItem] };
      },
    );
    const publish = vi.fn();
    const service = createTrackerService({
      call: call as never,
      getStorage,
      setStorage,
      rootThread: async () => ({ id: "thr_root", projectId: "proj_1" }),
      threadTitle: async () => "Tracker work",
      publish,
    });

    await expect(service.context("thr_child")).resolves.toMatchObject({
      primaryKey: "LIN-1",
      items: [{ item: { key: "LIN-1" } }, { item: { key: "LIN-2" } }],
    });
    await expect(service.setPrimary("thr_child", "lin-2")).resolves.toEqual({
      key: "LIN-2",
    });
    expect(getStorage).toHaveBeenCalledWith("work-linear-links:v2");
    expect(setStorage).toHaveBeenLastCalledWith({
      thr_root: {
        keys: [
          { projectId: "proj_1", locator: "issue-1", key: "LIN-1" },
          { projectId: "proj_1", locator: "issue-2", key: "LIN-2" },
        ],
        primaryKey: "LIN-2",
      },
    });
    expect(publish).toHaveBeenCalledWith("thr_root");

    await service.unlink("thr_child", "LIN-2");
    expect(setStorage).toHaveBeenLastCalledWith({
      thr_root: {
        keys: [{ projectId: "proj_1", locator: "issue-1", key: "LIN-1" }],
        primaryKey: "LIN-1",
      },
    });
  });

  it("recovers valid v2 links from malformed storage without reviving a stale primary", async () => {
    const v2 = {
      thr_root: {
        keys: [
          { projectId: "proj_1", locator: "issue-1", key: "LIN-1" },
          { projectId: "proj_1", locator: 4, key: "LIN-bad" },
          { projectId: "proj_1", locator: "issue-1-copy", key: "lin-1" },
        ],
        primaryKey: "LIN-missing",
      },
      thr_bad: { keys: "not-an-array", primaryKey: "LIN-9" },
    };
    const getStorage = vi.fn(async (key?: string) =>
      key === "work-linear-links:v2" ? v2 : undefined,
    );
    const setStorage = vi.fn();
    const service = createTrackerService({
      call: vi.fn(async (method: string) => {
        if (method === "getItem") return { item: { ...item, comments: [] } };
        if (method === "statusOptions")
          return {
            options: [
              {
                id: "todo",
                name: "Todo",
                stateCategory: "todo",
                current: true,
              },
            ],
          };
        return { items: [item] };
      }) as never,
      getStorage,
      setStorage,
      rootThread: async () => ({ id: "thr_root", projectId: "proj_1" }),
      threadTitle: async () => "Tracker work",
      publish: vi.fn(),
    });

    await expect(service.context("thr_child")).resolves.toMatchObject({
      primaryKey: "LIN-1",
      items: [{ item: { key: "LIN-1" } }],
    });
    expect(setStorage).not.toHaveBeenCalled();
  });
});

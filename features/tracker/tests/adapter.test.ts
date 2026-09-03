import { describe, expect, it, vi } from "vitest";
import { createTrackerService, type LinkState } from "../server";
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
  const links = new Map<string, LinkState>();
  const legacy = new Map<string, LinkState>(
    Object.entries(initialStorage as Record<string, unknown>).flatMap(
      ([rootThreadId, value]) => {
        if (!value || typeof value !== "object") return [];
        if (Array.isArray((value as LinkState).keys))
          return [[rootThreadId, value as LinkState] as const];
        const candidate = value as { projectId?: unknown; locator?: unknown; key?: unknown };
        return typeof candidate.projectId === "string" &&
          typeof candidate.locator === "string" &&
          typeof candidate.key === "string"
          ? [[rootThreadId, {
              keys: [{
                projectId: candidate.projectId,
                locator: candidate.locator,
                key: candidate.key,
              }],
              primaryKey: candidate.key,
            }] as const]
          : [];
      },
    ),
  );
  const publish = vi.fn();
  const setStorage = vi.fn(async (rootThreadId: string, value: LinkState | null) => {
    if (value === null) links.delete(rootThreadId);
    else links.set(rootThreadId, value);
  });
  return {
    call,
    publish,
    setStorage,
    service: createTrackerService({
      call: call as never,
      links: {
        get: async (rootThreadId) => links.get(rootThreadId) ?? legacy.get(rootThreadId),
        set: setStorage,
      },
      rootThread: async () => ({ id: "thr_root", projectId: "proj_1" }),
      threadTitle: async () => "Tracker work",
      publish,
    }),
  };
}

describe("Taskboard tracker adapter", () => {
  it("limits one root to 100 linked issues", async () => {
    const { service } = setup(vi.fn(async () => ({
      items: [{ ...item, key: "LIN-101", locator: "issue-101" }],
    })), {
      thr_root: {
        keys: Array.from({ length: 101 }, (_, index) => ({
          projectId: "proj_1",
          locator: `issue-${index}`,
          key: `LIN-${index}`,
        })).slice(0, 100),
        primaryKey: "LIN-0",
      },
    });
    await expect(service.link("thr_child", "LIN-101")).rejects.toThrow(
      "at most 100",
    );
  });

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
    expect(setStorage).toHaveBeenLastCalledWith("thr_root", {
        keys: [{ projectId: "proj_1", locator: "issue-1", key: "LIN-1" }],
        primaryKey: "LIN-1",
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
    expect(setStorage).toHaveBeenLastCalledWith("thr_root", null);
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

    expect(setStorage).toHaveBeenLastCalledWith("thr_root", {
        keys: [
          { projectId: "proj_1", locator: "issue-1", key: "LIN-1" },
          { projectId: "proj_1", locator: "issue-2", key: "LIN-2" },
        ],
        primaryKey: "LIN-1",
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
    expect(setStorage).toHaveBeenLastCalledWith("thr_root", {
        keys: [{ projectId: "proj_1", locator: "issue-2", key: "LIN-2" }],
        primaryKey: "LIN-2",
    });
    expect(publish).toHaveBeenCalledTimes(4);
  });

  it("preserves link order and writes the selected primary", async () => {
    const links = new Map<string, LinkState>([["thr_root", {
      keys: [
        { projectId: "proj_1", locator: "issue-1", key: "LIN-1" },
        { projectId: "proj_1", locator: "issue-2", key: "LIN-2" },
      ],
      primaryKey: "LIN-1",
    }]]);
    const setStorage = vi.fn(async (rootThreadId: string, value: LinkState | null) => {
      if (value) links.set(rootThreadId, value);
      else links.delete(rootThreadId);
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
      links: { get: async (rootThreadId) => links.get(rootThreadId), set: setStorage },
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
    expect(setStorage).toHaveBeenLastCalledWith("thr_root", {
        keys: [
          { projectId: "proj_1", locator: "issue-1", key: "LIN-1" },
          { projectId: "proj_1", locator: "issue-2", key: "LIN-2" },
        ],
        primaryKey: "LIN-2",
    });
    expect(publish).toHaveBeenCalledWith("thr_root");

    await service.unlink("thr_child", "LIN-2");
    expect(setStorage).toHaveBeenLastCalledWith("thr_root", {
        keys: [{ projectId: "proj_1", locator: "issue-1", key: "LIN-1" }],
        primaryKey: "LIN-1",
    });
  });

  it("uses a normalized stored primary", async () => {
    const links = new Map<string, LinkState>([["thr_root", {
      keys: [{ projectId: "proj_1", locator: "issue-1", key: "LIN-1" }],
      primaryKey: "LIN-1",
    }]]);
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
      links: { get: async (rootThreadId) => links.get(rootThreadId), set: setStorage },
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

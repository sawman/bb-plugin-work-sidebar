import { describe, expect, it, vi } from "vitest";
import { createTrackerService } from "../server";
import { taskboardItemSchema } from "../schemas";

const item = { bbProjectId: "proj_1", source: "linear" as const, locator: "issue-1", key: "LIN-1", title: "Tracker work", description: "", url: "https://linear.app/issue/LIN-1", status: "Todo", stateCategory: "todo" as const, priority: null, assignee: null, project: null, labels: [], updatedAt: "2026-01-01" };
const secondItem = {
  ...item,
  locator: "issue-2",
  key: "LIN-2",
  title: "Second tracker work",
  url: "https://linear.app/issue/LIN-2",
};
function setup(call = vi.fn(), initialStorage: unknown = {}) {
  let storage: unknown = initialStorage; const publish = vi.fn(); const setStorage = vi.fn(async (value) => { storage = value; });
  return { call, publish, setStorage, service: createTrackerService({ call, getStorage: async () => storage, setStorage, rootThread: async () => ({ id: "thr_root", projectId: "proj_1" }), threadTitle: async () => "Tracker work", publish }) };
}

describe("Taskboard tracker adapter", () => {
  it("rejects unknown fields at the strict Taskboard wire boundary", () => {
    expect(() => taskboardItemSchema.parse({ ...item, unexpected: true })).toThrow();
  });
  it("uses exact validated Taskboard calls and falls back from a title miss to recent issues", async () => {
    const { call, service } = setup(vi.fn().mockResolvedValueOnce({ items: [] }).mockResolvedValueOnce({ items: [item] }));
    await expect(service.context("thr_child")).resolves.toMatchObject({ visible: true, available: true, suggestions: [{ key: "LIN-1" }] });
    expect(call.mock.calls.map(([method, input]) => [method, input])).toEqual([["listItems", { projectId: "proj_1", source: "linear", query: "Tracker work", limit: 8 }], ["listItems", { projectId: "proj_1", source: "linear", query: "", limit: 8 }]]);
  });

  it("projects Taskboard data to the public RPC shape and bounds unavailable or malformed payloads", async () => {
    const hit = setup(vi.fn().mockResolvedValue({ items: [item] }));
    const context = await hit.service.context("thr_child");
    expect(context.suggestions).toEqual([{ key: "LIN-1", title: "Tracker work", url: item.url }]);
    expect(context.items).toEqual([]);
    const unavailable = setup(vi.fn().mockRejectedValue(new Error("Taskboard plugin is not installed")));
    await expect(unavailable.service.context("thr_child")).resolves.toMatchObject({ visible: true, available: false, message: "Taskboard plugin is not installed" });
    const nonLinear = setup(vi.fn().mockRejectedValue(new Error("Linear is not the selected tracker")));
    await expect(nonLinear.service.context("thr_child")).resolves.toMatchObject({ visible: false, available: false });
    const malformed = setup(vi.fn().mockImplementation(async (_m, _i, schema) => schema.parse({ items: [{ key: "bad" }] })));
    await expect(malformed.service.context("thr_child")).resolves.toMatchObject({ available: false });
  });

  it("searches, links, unlinks, and changes status through the root link with exact inputs", async () => {
    const call = vi.fn(async (method: string) => method === "updateItemStatus" ? { item: { ...item, status: "Done", stateCategory: "done" } } : { items: [item] });
    const { publish, setStorage, service } = setup(call);
    await expect(service.search("thr_child", "LIN")).resolves.toEqual({ items: [{ key: "LIN-1", title: "Tracker work", url: item.url }] });
    await expect(service.link("thr_child", "lin-1")).resolves.toEqual({ key: "LIN-1", title: "Tracker work" });
    expect(setStorage).toHaveBeenLastCalledWith({ thr_root: [{ projectId: "proj_1", locator: "issue-1", key: "LIN-1" }] });
    expect(publish).toHaveBeenLastCalledWith("thr_root");
    await expect(service.updateStatus("thr_child", "LIN-1", "done")).resolves.toEqual({ key: "LIN-1", status: "Done" });
    expect(call).toHaveBeenCalledWith("updateItemStatus", { projectId: "proj_1", source: "linear", locator: "issue-1", statusId: "done" }, expect.anything());
    await service.unlink("thr_child", "LIN-1");
    expect(setStorage).toHaveBeenLastCalledWith({});
    await expect(service.updateStatus("thr_child", "LIN-1", "done")).rejects.toThrow("LIN-1 is not linked");
    expect(call).toHaveBeenCalledWith("listItems", { projectId: "proj_1", source: "linear", query: "LIN", limit: 20 }, expect.anything());
  });

  it("reads a stored root link with exact item and status calls while stripping Taskboard-only fields", async () => {
    const call = vi.fn(async (method: string) => method === "getItem" ? { item: { ...item, comments: [] } } : method === "statusOptions" ? { options: [{ id: "todo", name: "Todo", stateCategory: "todo", current: true }] } : { items: [item] });
    const { service } = setup(call, {
      thr_root: { projectId: "proj_1", locator: "issue-1", key: "LIN-1" },
    });
    const context = await service.context("thr_child");
    expect(context.items).toEqual([{
      item: { key: "LIN-1", title: "Tracker work", url: item.url, status: "Todo", stateCategory: "todo", priority: null, assignee: null, project: null },
      statusOptions: [{ id: "todo", name: "Todo", current: true }],
    }]);
    expect(call).toHaveBeenCalledWith("getItem", { projectId: "proj_1", source: "linear", locator: "issue-1" }, expect.anything());
    expect(call).toHaveBeenCalledWith("statusOptions", { projectId: "proj_1", source: "linear", locator: "issue-1" }, expect.anything());
  });

  it("keeps multiple root links and targets status and unlink mutations by issue key", async () => {
    const call = vi.fn(async (method: string, input: Record<string, unknown>) => {
      const linkedItem = input.locator === "issue-2" || input.query === "LIN-2"
        ? secondItem
        : item;
      if (method === "getItem") return { item: { ...linkedItem, comments: [] } };
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
        return { item: { ...linkedItem, status: "Done", stateCategory: "done" } };
      return { items: [linkedItem] };
    });
    const { publish, setStorage, service } = setup(call);

    await service.link("thr_child", "LIN-1");
    await service.link("thr_child", "LIN-2");
    await service.link("thr_child", "LIN-1");

    expect(setStorage).toHaveBeenLastCalledWith({
      thr_root: [
        { projectId: "proj_1", locator: "issue-1", key: "LIN-1" },
        { projectId: "proj_1", locator: "issue-2", key: "LIN-2" },
      ],
    });
    expect(setStorage).toHaveBeenCalledTimes(2);
    expect(publish).toHaveBeenCalledTimes(2);
    await expect(service.context("thr_child")).resolves.toMatchObject({
      items: [
        { item: { key: "LIN-1" } },
        { item: { key: "LIN-2" } },
      ],
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
      thr_root: [
        { projectId: "proj_1", locator: "issue-2", key: "LIN-2" },
      ],
    });
    expect(publish).toHaveBeenCalledTimes(4);
  });
});

import { describe, expect, it, vi } from "vitest";
import { createTrackerService } from "../server";

const item = { bbProjectId: "proj_1", source: "linear" as const, locator: "issue-1", key: "LIN-1", title: "Tracker work", description: "", url: "https://linear.app/issue/LIN-1", status: "Todo", stateCategory: "todo" as const, priority: null, assignee: null, project: null, labels: [], updatedAt: "2026-01-01" };
function setup(call = vi.fn()) {
  let storage: unknown = {}; const publish = vi.fn();
  return { call, publish, service: createTrackerService({ call, getStorage: async () => storage, setStorage: async (value) => { storage = value; }, rootThread: async () => ({ id: "thr_root", projectId: "proj_1" }), threadTitle: async () => "Tracker work", publish }) };
}

describe("Taskboard tracker adapter", () => {
  it("uses exact validated Taskboard calls and falls back from a title miss to recent issues", async () => {
    const { call, service } = setup(vi.fn().mockResolvedValueOnce({ items: [] }).mockResolvedValueOnce({ items: [item] }));
    await expect(service.context("thr_child")).resolves.toMatchObject({ visible: true, available: true, suggestions: [{ key: "LIN-1" }] });
    expect(call.mock.calls.map(([method, input]) => [method, input])).toEqual([["listItems", { projectId: "proj_1", source: "linear", query: "Tracker work", limit: 8 }], ["listItems", { projectId: "proj_1", source: "linear", query: "", limit: 8 }]]);
  });

  it("projects Taskboard data to the public RPC shape and bounds unavailable or malformed payloads", async () => {
    const hit = setup(vi.fn().mockResolvedValue({ items: [item] }));
    const context = await hit.service.context("thr_child");
    expect(context.suggestions).toEqual([{ key: "LIN-1", title: "Tracker work", url: item.url }]);
    expect(context.item).toBeNull();
    const unavailable = setup(vi.fn().mockRejectedValue(new Error("Taskboard plugin is not installed")));
    await expect(unavailable.service.context("thr_child")).resolves.toMatchObject({ visible: true, available: false, message: "Taskboard plugin is not installed" });
    const nonLinear = setup(vi.fn().mockRejectedValue(new Error("Linear is not the selected tracker")));
    await expect(nonLinear.service.context("thr_child")).resolves.toMatchObject({ visible: false, available: false });
    const malformed = setup(vi.fn().mockImplementation(async (_m, _i, schema) => schema.parse({ items: [{ key: "bad" }] })));
    await expect(malformed.service.context("thr_child")).resolves.toMatchObject({ available: false });
  });

  it("searches, links, unlinks, and changes status through the root link with exact inputs", async () => {
    const { call, publish, service } = setup(vi.fn().mockResolvedValue({ items: [item] }));
    await expect(service.search("thr_child", "LIN")).resolves.toEqual({ items: [{ key: "LIN-1", title: "Tracker work", url: item.url }] });
    await expect(service.link("thr_child", "lin-1")).resolves.toEqual({ key: "LIN-1", title: "Tracker work" });
    expect(publish).toHaveBeenLastCalledWith("thr_root");
    await service.unlink("thr_child");
    await expect(service.updateStatus("thr_child", "done")).rejects.toThrow("Link a Linear issue");
    expect(call).toHaveBeenCalledWith("listItems", { projectId: "proj_1", source: "linear", query: "LIN", limit: 20 }, expect.anything());
  });
});

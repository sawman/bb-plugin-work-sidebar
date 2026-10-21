// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { loadPluginApp, renderSlot, type RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import type { rpcContract } from "../../../contracts";
import { getPluginQueryClient, queryKeys, queryPolicies } from "../../../query-runtime";
import { threadInteractionStore } from "../../threads/store";

type Rpc = NonNullable<RenderSlotOptions<typeof rpcContract>["rpc"]>;
const fixture = {
  sidebarTasks: () => ({ available: true, tasks: [], projects: [], error: null }),
  sidebarTaskLinks: () => ({ available: true, links: {}, error: null }),
  getWorkStatus: () => ({ rootThreadId: "thr_root", currentThread: { title: "Storage", status: "idle", runtimeStatus: "idle", providerId: "codex" }, children: [] }),
  getLatestActivity: () => ({ currentThread: { status: "idle", runtimeStatus: "idle" }, latest: null, lastUser: null, current: null }),
  getWorkOutcome: () => ({ rootThreadId: "thr_root", tasksAvailable: true, outcome: null, executionTasks: [], bindings: [], legacy: { state: "none", taskIds: [], message: null } }),
  getWorkGoal: () => null,
  getWorkPlan: () => ({ items: [] }),
  getWorkProviderStatus: () => ({ tone: "green", providerId: "codex", providerName: "Codex", statusUrl: null, status: "ready", message: null }),
  getWorkTracker: () => ({ visible: false, available: false, message: null, suggestions: [], items: [] }),
  getWorkBackgroundJobs: () => ({ items: [] }),
  listHumanMessages: () => ({ messages: [], cursor: null, activeCount: 0, savedCount: 0, historyCount: 0 }),
} as unknown as Rpc;

const pathEntry = (path: string, kind: "directory" | "file" = "file") => ({ path, kind, name: path.split("/").at(-1)!, score: 0, positions: [] });
const listing = (paths = [pathEntry("report.md")], truncated = false, storageRootPath = "/private/host/thread/root") => ({ paths, truncated, storageRootPath });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

async function mount(storagePaths = vi.fn().mockResolvedValue(listing()), threadId = "thr_a") {
  threadInteractionStore.getState().setWorkTab(threadId, "work");
  const app = await loadPluginApp(() => import("../../../app"));
  const slot = renderSlot(app.threadPanelActions[0]!, { threadId, params: null }, {
    rpc: fixture,
    sdk: { threads: { storagePaths } },
  });
  const switchThread = (next: string) => slot.lifecycle.rerender(createElement(app.threadPanelActions[0]!.component, { threadId: next, params: null }));
  const toggle = () => fireEvent.click(slot.getByRole("button", { name: "Thread storage" }));
  return { slot, storagePaths, switchThread, toggle };
}

describe("registered Work Thread storage", () => {
  afterEach(() => { cleanup(); getPluginQueryClient().clear(); vi.useRealTimers(); });

  it("registers a collapsed card after Background, loads independently and only while open", async () => {
    const pending = deferred<ReturnType<typeof listing>>();
    const { slot, toggle, storagePaths } = await mount(vi.fn(() => pending.promise));
    expect(slot.getByRole("button", { name: "Thread storage" }).getAttribute("aria-expanded")).toBe("false");
    expect(storagePaths).not.toHaveBeenCalled();
    const cards = [...slot.container.querySelectorAll(".ws-work-context-cards > article")];
    expect(cards.at(-1)?.getAttribute("data-card")).toBe("thread storage");
    toggle();
    expect(slot.getByText("Loading thread storage…")).toBeTruthy();
    expect(await slot.findByText("No provider background jobs")).toBeTruthy();
    expect(storagePaths).toHaveBeenCalledExactlyOnceWith({ threadId: "thr_a", limit: "200", includeDirectories: "true", includeFiles: "true", signal: expect.any(AbortSignal) });
    await act(async () => pending.resolve(listing([])));
    expect(await slot.findByText("No stored files or folders")).toBeTruthy();
  });

  it("sorts directories first, reveals nested lists lazily, truncates long names and uses native links", async () => {
    const longName = `${"long".repeat(80)}.md`;
    const { slot, toggle, storagePaths } = await mount(vi.fn().mockResolvedValue(listing([
      pathEntry("z.md"), pathEntry("docs/report.md"), pathEntry("docs", "directory"), pathEntry(longName), pathEntry("docs/deep/note.md"),
    ])));
    toggle();
    const folder = await slot.findByRole("button", { name: "docs" });
    expect(slot.queryByRole("link", { name: "report.md" })).toBeNull();
    const rootList = slot.getByRole("list", { name: "Stored files and folders" });
    expect(rootList.firstElementChild?.textContent).toBe("docs");
    expect(slot.getByRole("link", { name: longName }).classList.contains("ws-storage-row")).toBe(true);
    expect(slot.container.querySelector('[data-icon="Folder"] path')).toBeTruthy();
    expect(slot.container.querySelector('[data-icon="File"] path')).toBeTruthy();
    fireEvent.click(folder);
    const report = await slot.findByRole("link", { name: "report.md" });
    expect(folder.getAttribute("aria-expanded")).toBe("true");
    expect(slot.getByRole("button", { name: "deep" })).toBeTruthy();
    expect(storagePaths).toHaveBeenCalledOnce();
    fireEvent.click(report);
    expect(slot.navigateCalls.at(-1)).toEqual({ method: "experimental_openFilePreview", options: { target: { kind: "thread-storage", threadId: "thr_a", path: "docs/report.md" }, location: null } });
    const calls = slot.navigateCalls.length;
    for (const modifier of ["metaKey", "ctrlKey", "shiftKey", "altKey"]) {
      expect(fireEvent.click(report, { [modifier]: true })).toBe(true);
    }
    expect(fireEvent.contextMenu(report)).toBe(true);
    expect(slot.navigateCalls).toHaveLength(calls);
    expect(slot.container.querySelector('[role="tree"], [title]')).toBeNull();
    expect((await axe(slot.container)).violations).toEqual([]);
  });

  it("never exposes malformed paths as native file targets, nor raw host roots in DOM/cache/errors", async () => {
    const { slot, toggle } = await mount(vi.fn().mockResolvedValue(listing([
      pathEntry("../escape.md"), pathEntry("/absolute.md"), pathEntry("a\\escape.md"), pathEntry("a/./bad.md"), pathEntry("bad\u0000.md"), pathEntry("safe name.md"),
    ])));
    toggle();
    expect(await slot.findByRole("link", { name: "safe name.md" })).toBeTruthy();
    expect(slot.getAllByRole("link")).toHaveLength(1);
    expect(slot.container.textContent).not.toContain("/private/host");
    const cached = getPluginQueryClient().getQueryData(queryKeys.work.storage("thr_a"));
    expect(JSON.stringify(cached)).not.toContain("/private/host");
    expect(JSON.stringify(cached)).not.toContain("storageRootPath");
  });

  it("shows an incomplete listing notice without empty-folder claims or invented totals", async () => {
    const { slot, toggle } = await mount(vi.fn().mockResolvedValue(listing([pathEntry("docs", "directory")], true)));
    toggle();
    fireEvent.click(await slot.findByRole("button", { name: "docs" }));
    expect(slot.getByText("Listing incomplete; some entries are not shown.")).toBeTruthy();
    expect(slot.queryByText(/empty|No stored|0 files/i)).toBeNull();
  });

  it("shows a safe initial error without auto-retry and recovers through the compact retry", async () => {
    const storagePaths = vi.fn().mockRejectedValueOnce(new Error("host /private/host/thread/root failed")).mockResolvedValue(listing([]));
    const { slot, toggle } = await mount(storagePaths);
    toggle();
    expect(await slot.findByText("Could not load thread storage")).toBeTruthy();
    const retry = slot.getByRole("button", { name: "Retry thread storage" });
    expect(retry.classList.contains("ws-refresh-button")).toBe(true);
    expect(storagePaths).toHaveBeenCalledOnce();
    expect(JSON.stringify(getPluginQueryClient().getQueryState(queryKeys.work.storage("thr_a"))?.error)).not.toContain("/private/host");
    fireEvent.click(retry);
    expect(await slot.findByText("No stored files or folders")).toBeTruthy();
  });

  it("uses focusable native disclosure buttons and anchors without intercepting keyboard activation", async () => {
    const { slot, toggle } = await mount(vi.fn().mockResolvedValue(listing([pathEntry("docs/report.md")])));
    const heading = slot.getByRole("button", { name: "Thread storage" });
    heading.focus();
    expect(document.activeElement).toBe(heading);
    expect(heading.getAttribute("type")).toBe("button");
    toggle();
    const folder = await slot.findByRole("button", { name: "docs" });
    folder.focus();
    expect(document.activeElement).toBe(folder);
    expect(folder.getAttribute("type")).toBe("button");
    // Browsers synthesize a primary click for Enter/Space on native buttons.
    fireEvent.click(folder, { detail: 0 });
    const file = slot.getByRole("link", { name: "report.md" });
    file.focus();
    expect(document.activeElement).toBe(file);
    fireEvent.click(file, { detail: 0 });
    expect(slot.navigateCalls.at(-1)).toMatchObject({ method: "experimental_openFilePreview", options: { target: { threadId: "thr_a", path: "docs/report.md" } } });
  });

  it("retains cached rows on refresh and errors, retries compactly, and prunes disappeared disclosures", async () => {
    const pending = deferred<ReturnType<typeof listing>>();
    const storagePaths = vi.fn().mockResolvedValueOnce(listing([pathEntry("docs/report.md")])).mockImplementationOnce(() => pending.promise).mockResolvedValue(listing([pathEntry("other.md")], false, "/changed/root"));
    const { slot, toggle } = await mount(storagePaths);
    toggle();
    fireEvent.click(await slot.findByRole("button", { name: "docs" }));
    expect(slot.getByRole("link", { name: "report.md" })).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Refresh thread storage" }));
    expect(slot.getByRole("link", { name: "report.md" })).toBeTruthy();
    await act(async () => pending.reject(new Error("offline /private/host/thread/root")));
    expect(await slot.findByRole("alert")).toHaveProperty("textContent", "Could not load thread storage");
    expect(slot.getByRole("link", { name: "report.md" })).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Retry thread storage" }));
    expect(await slot.findByRole("link", { name: "other.md" })).toBeTruthy();
    expect(slot.queryByRole("button", { name: "docs" })).toBeNull();
    expect(slot.container.textContent).not.toContain("/private/host");
    const query = getPluginQueryClient().getQueryCache().find({ queryKey: queryKeys.work.storage("thr_a") })!;
    expect(query.state.error?.message).toBeUndefined();
  });

  it("isolates A→B→A disclosures and late replies; file targets always use the panel thread", async () => {
    const aRead = deferred<ReturnType<typeof listing>>();
    const bRead = deferred<ReturnType<typeof listing>>();
    const storagePaths = vi.fn().mockReturnValueOnce(aRead.promise).mockReturnValueOnce(bRead.promise).mockResolvedValue(listing([pathEntry("fresh.md")]));
    const { slot, toggle, switchThread } = await mount(storagePaths);
    toggle();
    switchThread("thr_b");
    expect(slot.getByRole("button", { name: "Thread storage" }).getAttribute("aria-expanded")).toBe("false");
    toggle();
    switchThread("thr_a");
    toggle();
    await act(async () => { aRead.resolve(listing([pathEntry("late-a.md")])); bRead.resolve(listing([pathEntry("late-b.md")])); });
    const file = await slot.findByRole("link", { name: "fresh.md" });
    expect(slot.queryByText(/late-[ab]/)).toBeNull();
    fireEvent.click(file);
    expect(slot.navigateCalls.at(-1)).toMatchObject({ method: "experimental_openFilePreview", options: { target: { threadId: "thr_a", path: "fresh.md" } } });
    expect(storagePaths.mock.calls[0]![0].signal.aborted).toBe(true);
    expect(storagePaths.mock.calls[1]![0].signal.aborted).toBe(true);
  });

  it("restarts an initial fetch on panel refresh without losing to the canceled late reply", async () => {
    const oldRead = deferred<ReturnType<typeof listing>>();
    const storagePaths = vi.fn().mockReturnValueOnce(oldRead.promise).mockResolvedValue(listing([pathEntry("new.md")]));
    const { slot, toggle } = await mount(storagePaths);
    toggle();
    await waitFor(() => expect((slot.getByRole("button", { name: "Refresh work context" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(slot.getByRole("button", { name: "Refresh work context" }));
    expect(await slot.findByRole("link", { name: "new.md" })).toBeTruthy();
    await act(async () => oldRead.resolve(listing([pathEntry("old.md")])));
    expect(slot.queryByText("old.md")).toBeNull();
    expect(storagePaths.mock.calls[0]![0].signal.aborted).toBe(true);
  });

  it("does no storage work for generic realtime, collapsed manual refresh or inactive tabs; reopens fresh", async () => {
    const { slot, toggle, storagePaths } = await mount();
    await slot.emitRealtime("work-sidebar:changed", { family: "work", rootThreadId: "thr_root" });
    fireEvent.click(slot.getByRole("button", { name: "Refresh work context" }));
    await act(async () => {});
    expect(storagePaths).not.toHaveBeenCalled();
    toggle();
    await slot.findByRole("link", { name: "report.md" });
    toggle();
    const query = getPluginQueryClient().getQueryCache().find({ queryKey: queryKeys.work.storage("thr_a") })!;
    expect(query.getObserversCount()).toBe(0);
    toggle();
    await waitFor(() => expect(storagePaths).toHaveBeenCalledTimes(2));
    fireEvent.click(slot.getByRole("tab", { name: "Agents" }));
    expect(query.getObserversCount()).toBe(0);
    slot.lifecycle.unmount();
    expect(query.getObserversCount()).toBe(0);
  });

  it("declares finite cache and display bounds, no polling, focus or automatic retry", async () => {
    expect(queryPolicies.threadStorage).toMatchObject({ staleTime: 0, gcTime: 120_000, retry: false, refetchOnWindowFocus: false, refetchOnReconnect: false });
    const { slot, toggle } = await mount(vi.fn().mockResolvedValue(listing(Array.from({ length: 250 }, (_, index) => pathEntry(`file-${index}.md`)))));
    toggle();
    await slot.findByRole("link", { name: "file-0.md" });
    expect(slot.getAllByRole("link").length).toBeLessThanOrEqual(200);
    const query = getPluginQueryClient().getQueryCache().find({ queryKey: queryKeys.work.storage("thr_a") })!;
    expect(query.options).toMatchObject({ refetchInterval: false });
    expect(JSON.stringify(query.state.data).length).toBeLessThan(100_000);
    vi.useFakeTimers();
    toggle();
    await act(async () => vi.advanceTimersByTimeAsync(120_001));
    expect(getPluginQueryClient().getQueryCache().find({ queryKey: queryKeys.work.storage("thr_a") })).toBeUndefined();
  });
});

// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { loadPluginApp, renderSlot, type RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import type { rpcContract } from "../../../contracts";
import { getPluginQueryClient, queryKeys, queryPolicies } from "../../../query-runtime";
import { threadInteractionStore } from "../../threads/store";

const { saveFile } = vi.hoisted(() => ({ saveFile: vi.fn().mockResolvedValue("started") }));
vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => ({
  ...await importOriginal<typeof import("@get-bb/plugin-sdk/app")>(),
  experimental_saveFile: saveFile,
}));

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
    pluginId: "work-sidebar",
    rpc: fixture,
    sdk: { threads: { storagePaths } },
  });
  const switchThread = (next: string) => slot.lifecycle.rerender(createElement(app.threadPanelActions[0]!.component, { threadId: next, params: null }));
  const toggle = () => fireEvent.click(slot.getByRole("button", { name: "Thread storage" }));
  return { slot, storagePaths, switchThread, toggle };
}

describe("registered Work Thread storage", () => {
  afterEach(() => { cleanup(); getPluginQueryClient().clear(); vi.useRealTimers(); vi.unstubAllGlobals(); saveFile.mockReset().mockResolvedValue("started"); });

  it("offers separate downloads only for files; preserves preview and exact thread/path through a pending download", async () => {
    const pending = deferred<Response>();
    const fetchFile = vi.fn(() => pending.promise);
    vi.stubGlobal("fetch", fetchFile);
    const path = "docs/财务 #1?.bin";
    const { slot, toggle } = await mount(vi.fn().mockResolvedValue(listing([pathEntry(path)])), "thr_b");
    toggle();
    expect(slot.queryByRole("link", { name: /^Download/ })).toBeNull();
    fireEvent.click(await slot.findByRole("button", { name: "docs" }));
    const download = slot.getByRole("link", { name: "Download 财务 #1?.bin" });
    const url = new URL(download.getAttribute("href")!, "http://localhost");
    expect(url.pathname).toBe("/api/v1/plugins/work-sidebar/http/thread-storage/download");
    expect([...url.searchParams]).toEqual([["threadId", "thr_b"], ["path", path]]);
    expect(download.getAttribute("download")).toBe("财务 #1?.bin");
    expect(slot.queryByRole("link", { name: "Download docs" })).toBeNull();
    download.focus();
    expect(document.activeElement).toBe(download);
    expect(slot.getByRole("tooltip", { name: "Download file" })).toBeTruthy();
    fireEvent.click(download, { detail: 0 });
    await waitFor(() => expect(download.getAttribute("aria-disabled")).toBe("true"));
    expect(download.getAttribute("aria-busy")).toBe("true");
    expect(download.querySelector('[data-icon="LoaderCircle"][data-motion="spin"]')).toBeTruthy();
    const pendingStatus = slot.getByRole("status");
    expect(pendingStatus.textContent).toBe("Preparing 财务 #1?.bin…");
    expect(pendingStatus.classList.contains("ws-sr-only")).toBe(true);
    expect(slot.container.querySelector("p[role=status]")).toBeNull();
    fireEvent.click(download);
    expect(fetchFile).toHaveBeenCalledTimes(1);
    expect(fetchFile.mock.calls[0]).toEqual([download.getAttribute("href"), expect.objectContaining({ credentials: "same-origin" })]);
    fireEvent.click(slot.getByRole("link", { name: "财务 #1?.bin" }));
    expect(slot.navigateCalls.at(-1)).toMatchObject({ method: "experimental_openFilePreview", options: { target: { kind: "thread-storage", threadId: "thr_b", path } } });
    const blob = new Blob([new Uint8Array([0, 255, 128])]);
    await act(async () => pending.resolve({ ok: true, blob: async () => blob } as Response));
    await waitFor(() => expect(saveFile).toHaveBeenCalledExactlyOnceWith({ fileName: "财务 #1?.bin", blob }));
    await waitFor(() => expect(download.hasAttribute("aria-disabled")).toBe(false));
    expect(download.querySelector('[data-icon="Download"]')).toBeTruthy();
    expect(slot.queryByRole("status")).toBeNull();
    expect((await axe(slot.container)).violations).toEqual([]);
    expect(slot.container.querySelector("a a, [title]")).toBeNull();
  });

  it("reports safe download failures, retries, and leaves modifier/context-menu actions native", async () => {
    const fetchFile = vi.fn().mockResolvedValueOnce({ ok: false, text: async () => "/private/host" }).mockRejectedValueOnce(new Error("/private/host offline")).mockResolvedValue({ ok: true, blob: async () => new Blob(["text"]) });
    vi.stubGlobal("fetch", fetchFile);
    const { slot, toggle } = await mount();
    toggle();
    const download = await slot.findByRole("link", { name: "Download report.md" });
    for (const modifier of ["metaKey", "ctrlKey", "shiftKey", "altKey"]) expect(fireEvent.click(download, { [modifier]: true })).toBe(true);
    expect(fireEvent.contextMenu(download)).toBe(true);
    expect(fetchFile).not.toHaveBeenCalled();
    for (let index = 0; index < 2; index++) {
      fireEvent.click(download);
      expect(await slot.findByRole("alert")).toHaveProperty("textContent", "Could not download report.md. Try again.");
      expect(saveFile).not.toHaveBeenCalled();
      expect(slot.container.textContent).not.toContain("/private/host");
    }
    saveFile.mockResolvedValueOnce("failed");
    fireEvent.click(download);
    await waitFor(() => expect(saveFile).toHaveBeenCalledOnce());
    expect(await slot.findByRole("alert")).toBeTruthy();
    fireEvent.click(download);
    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(slot.queryByRole("alert")).toBeNull());
    expect(slot.navigateCalls.filter((call) => call.method === "experimental_openFilePreview")).toEqual([]);
  });

  it("keeps late download state scoped to the original thread when switching A→B", async () => {
    const pending = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue({ ok: true, blob: async () => new Blob(["B"]) }));
    const { slot, toggle, switchThread } = await mount();
    toggle();
    fireEvent.click(await slot.findByRole("link", { name: "Download report.md" }));
    switchThread("thr_b");
    toggle();
    const download = await slot.findByRole("link", { name: "Download report.md" });
    expect(download.getAttribute("href")).toContain("threadId=thr_b");
    expect(download.hasAttribute("aria-disabled")).toBe(false);
    await act(async () => pending.resolve({ ok: false } as Response));
    expect(slot.queryByRole("alert")).toBeNull();
    fireEvent.click(download);
    await waitFor(() => expect(saveFile).toHaveBeenCalledOnce());
  });

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
    expect(slot.getAllByRole("link")).toHaveLength(2);
    expect(slot.container.textContent).not.toContain("/private/host");
    const cached = getPluginQueryClient().getQueryData(queryKeys.work.storage("thr_a"));
    expect(JSON.stringify(cached)).not.toContain("/private/host");
    expect(JSON.stringify(cached)).not.toContain("storageRootPath");
  });

  it("highlights refresh for an incomplete listing, explains it on focus, and clears the warning after a complete refresh", async () => {
    const refreshed = deferred<ReturnType<typeof listing>>();
    const { slot, toggle, storagePaths } = await mount(vi.fn().mockResolvedValueOnce(listing([pathEntry("docs", "directory")], true)).mockReturnValueOnce(refreshed.promise));
    toggle();
    fireEvent.click(await slot.findByRole("button", { name: "docs" }));
    expect(slot.queryByText("Listing incomplete; some entries are not shown.")).toBeNull();
    const refresh = slot.getByRole("button", { name: "Refresh thread storage" });
    expect(refresh.getAttribute("data-tone")).toBe("warning");
    act(() => refresh.focus());
    expect(document.activeElement).toBe(refresh);
    const tooltip = slot.getByRole("tooltip", { name: "Listing incomplete; refresh" });
    expect(refresh.getAttribute("aria-describedby")).toBe(tooltip.id);
    expect(tooltip.getAttribute("data-open")).toBe("true");
    expect(slot.queryByText(/empty|No stored|0 files/i)).toBeNull();
    expect((await axe(slot.container)).violations).toEqual([]);
    fireEvent.click(refresh);
    await waitFor(() => expect(storagePaths).toHaveBeenCalledTimes(2));
    expect(refresh.getAttribute("data-tone")).toBe("warning");
    expect(refresh.getAttribute("aria-busy")).toBe("true");
    await act(async () => refreshed.resolve(listing([])));
    expect(await slot.findByText("No stored files or folders")).toBeTruthy();
    expect(refresh.hasAttribute("data-tone")).toBe(false);
    expect(slot.queryByRole("tooltip", { name: "Listing incomplete; refresh" })).toBeNull();
  });

  it("keeps incomplete empty listings truthful and isolates warning state when switching threads", async () => {
    const { slot, toggle, switchThread } = await mount(vi.fn().mockResolvedValueOnce(listing([], true)).mockResolvedValue(listing([])));
    toggle();
    await waitFor(() => expect(slot.getByRole("button", { name: "Refresh thread storage" }).getAttribute("data-tone")).toBe("warning"));
    expect(slot.queryByText("Listing incomplete; some entries are not shown.")).toBeNull();
    expect(slot.queryByText("No stored files or folders")).toBeNull();
    switchThread("thr_b");
    toggle();
    expect(await slot.findByText("No stored files or folders")).toBeTruthy();
    expect(slot.getByRole("button", { name: "Refresh thread storage" }).hasAttribute("data-tone")).toBe(false);
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
    expect(slot.getAllByRole("link").filter((link) => !link.hasAttribute("download")).length).toBeLessThanOrEqual(200);
    const query = getPluginQueryClient().getQueryCache().find({ queryKey: queryKeys.work.storage("thr_a") })!;
    expect(query.options).toMatchObject({ refetchInterval: false });
    expect(JSON.stringify(query.state.data).length).toBeLessThan(100_000);
    vi.useFakeTimers();
    toggle();
    await act(async () => vi.advanceTimersByTimeAsync(120_001));
    expect(getPluginQueryClient().getQueryCache().find({ queryKey: queryKeys.work.storage("thr_a") })).toBeUndefined();
  });
});

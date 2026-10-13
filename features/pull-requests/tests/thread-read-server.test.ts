import { describe, expect, it, vi } from "vitest";
import { createThreadReadService } from "../thread-read-server";
import { createThreadStackService } from "../server-thread-stack";
import { createServerLifecycle } from "../../../server-lifecycle";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((complete, fail) => { resolve = complete; reject = fail; });
  return { promise, resolve, reject };
}
describe("thread PR in-flight ownership", () => {
  it("coalesces only concurrent reads, isolates threads, retries failure and retains no settled data", async () => {
    const a = deferred<string>();
    const b = deferred<string>();
    const load = vi.fn((threadId: string) => threadId === "thr_a" ? a.promise : b.promise);
    const service = createThreadReadService(load);
    const first = service.read("thr_a");
    expect(service.read("thr_a")).toBe(first);
    const other = service.read("thr_b");
    await Promise.resolve();
    expect(load.mock.calls).toEqual([["thr_a"], ["thr_b"]]);
    b.reject(new Error("offline"));
    await expect(other).rejects.toThrow("offline");
    a.resolve("A");
    await expect(first).resolves.toBe("A");
    expect(service.inspect().pending).toBe(0);
    load.mockResolvedValueOnce("retry");
    await expect(service.read("thr_b")).resolves.toBe("retry");
    expect(load).toHaveBeenCalledTimes(3);
  });

  it("invalidated late work cannot settle as current or remove a replacement; disposal rejects pending and new reads", async () => {
    const old = deferred<string>();
    const replacement = deferred<string>();
    const load = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(replacement.promise);
    const service = createThreadReadService(load);
    const first = service.read("thr_a");
    await Promise.resolve();
    service.invalidate("thr_a");
    const second = service.read("thr_a");
    await Promise.resolve();
    old.resolve("old");
    await expect(first).rejects.toThrow("changed during the read");
    expect(service.read("thr_a")).toBe(second);
    expect(service.inspect().pending).toBe(1);
    service.dispose();
    expect(service.inspect()).toEqual({ pending: 0, disposed: true });
    replacement.resolve("late after reload");
    await expect(second).rejects.toThrow("disposed");
    await expect(service.read("thr_a")).rejects.toThrow("disposed");
    const reloaded = createThreadReadService(async () => "new handle");
    await expect(reloaded.read("thr_a")).resolves.toBe("new handle");
  });

  it("summary, enrichment, directory and file resolver share one host PR lookup; gh-stack starts before host completion", async () => {
    const remote = deferred<{ outcome: "not_applicable"; message: string }>();
    const pullRequest = vi.fn(() => remote.promise);
    const callRpc = vi.fn(async () => ({ stack: null, pending: null, error: null, fetchedAt: 1 }));
    const bb = { sdk: { threads: { get: vi.fn(async () => ({ environmentId: "env_a" })) }, environments: { pullRequest }, plugins: { callRpc } } };
    const lifecycle = createServerLifecycle();
    const service = createThreadStackService(bb as never, lifecycle, vi.fn(async () => "[]"));
    const reads = [service.summary("thr_a"), service.projection("thr_a"), service.sidebarThreadPullRequests({ threadIds: ["thr_a"] }), service.fileDiff("thr_a", 1, "a.ts")];
    await Promise.resolve(); await Promise.resolve();
    expect(callRpc).toHaveBeenCalledTimes(1);
    expect(pullRequest).toHaveBeenCalledTimes(1);
    remote.resolve({ outcome: "not_applicable", message: "No PR" });
    await Promise.all(reads);
    await service.summary("thr_a");
    expect(pullRequest).toHaveBeenCalledTimes(2);
    lifecycle.dispose();
    await expect(service.summary("thr_a")).rejects.toThrow("disposed");
  });
});

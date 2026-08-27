// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { invalidateTaskQueries, useTasksMutations } from "../mutations";
import { queryKeys } from "../../../query-runtime";

const task = { id: "task_1", projectId: "project_1", projectName: "Work", key: "WORK-1", title: "Task", status: "todo" as const, priority: "none" as const, dueDate: null, parentTaskId: null, position: 1, linkedThreadIds: [], assignee: "human" as const };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((ok, bad) => { resolve = ok; reject = bad; }); return { promise, resolve, reject }; }
function setup(rpc: { call: ReturnType<typeof vi.fn> }) { const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } }); client.setQueryData(queryKeys.sidebar.tasks.list(), { tasks: [task] }); const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>; return { client, hook: renderHook(() => useTasksMutations(rpc as never), { wrapper }) }; }

describe("Tasks mutations", () => {
  it("cancels, snapshots, projects, rolls back, and settles assignment in order", async () => {
    const pending = deferred<unknown>(); const rpc = { call: vi.fn(() => pending.promise) }; const { client, hook } = setup(rpc); const cancel = vi.spyOn(client, "cancelQueries"); const invalidate = vi.spyOn(client, "invalidateQueries");
    const run = hook.result.current.assignment.mutateAsync({ taskId: task.id, assignee: "agent" });
    await waitFor(() => expect(client.getQueryData<{ tasks: typeof task[] }>(queryKeys.sidebar.tasks.list())?.tasks[0]?.assignee).toBe("agent"));
    expect(cancel).toHaveBeenCalledWith({ queryKey: queryKeys.sidebar.tasks.list() }); expect(invalidate).not.toHaveBeenCalled();
    pending.reject(new Error("nope")); await expect(run).rejects.toThrow("nope");
    expect(client.getQueryData<{ tasks: typeof task[] }>(queryKeys.sidebar.tasks.list())?.tasks[0]?.assignee).toBe("human"); expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.sidebar.tasks.list() });
  });

  it("keeps invalidation client-local and never projects non-reversible mutations", async () => {
    const rpc = { call: vi.fn((method: string) => method === "deleteSidebarTask" ? Promise.resolve({ deleted: false }) : Promise.resolve({})) }; const { client, hook } = setup(rpc); const before = client.getQueryData(queryKeys.sidebar.tasks.list());
    const other = new QueryClient(); const invalidation = vi.spyOn(other, "invalidateQueries"); await invalidateTaskQueries(other, ["links"]); expect(invalidation).toHaveBeenCalledWith({ queryKey: queryKeys.sidebar.tasks.links() });
    await hook.result.current.create.mutateAsync({ projectId: "project_1", title: "New", assignee: "human" }); await hook.result.current.attachment.mutateAsync({ taskId: task.id, threadId: "thr_1", attached: true }); await hook.result.current.status.mutateAsync({ taskId: task.id, status: "done" }); await expect(hook.result.current.remove.mutateAsync({ taskId: task.id })).rejects.toThrow("Task was not found.");
    expect(client.getQueryData(queryKeys.sidebar.tasks.list())).toEqual(before);
  });

  it("defers one realtime list+links flush until overlapping assignment and reorder settle", async () => {
    const assign = deferred<unknown>(); const reorder = deferred<unknown>();
    const rpc = { call: vi.fn((method: string) => method === "updateTaskAssignee" ? assign.promise : method === "reorderTask" ? reorder.promise : Promise.resolve({})) };
    const { client, hook } = setup(rpc); client.setQueryData(queryKeys.sidebar.tasks.list(), { tasks: [task, { ...task, id: "task_2", position: 2 }] });
    const invalidations: string[] = []; vi.spyOn(client, "invalidateQueries").mockImplementation(async ({ queryKey }) => { invalidations.push((queryKey as string[]).at(-1)!); });
    const a = hook.result.current.assignment.mutateAsync({ taskId: task.id, assignee: "agent" }); const r = hook.result.current.reorder.mutateAsync({ taskId: task.id, beforeTaskId: "task_2", afterTaskId: null });
    await waitFor(() => expect(rpc.call).toHaveBeenCalledTimes(2)); await invalidateTaskQueries(client, ["list", "links"]); expect(invalidations).toEqual([]);
    assign.resolve({}); await a; expect(invalidations).toEqual([]);
    reorder.resolve({}); await r; expect(invalidations.sort()).toEqual(["links", "list"]);
  });
});

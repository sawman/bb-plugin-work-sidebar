// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  invalidateTaskQueries,
  taskOptimisticMutationKey,
  useTasksMutations,
} from "../mutations";
import { queryKeys } from "../../../query-runtime";
import type { TaskFact, TaskFactDirectory } from "../facts";
import type { SidebarTask } from "../../../work-model";

const projectScope = "project_scope";
const task = {
  id: "task_1",
  projectId: "project_1",
  projectName: "Work",
  key: "WORK-1",
  title: "Task",
  status: "todo" as const,
  priority: "none" as const,
  dueDate: null,
  parentTaskId: null,
  position: 1,
  linkedThreadIds: [],
  assignee: "human" as const,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((ok, bad) => {
    resolve = ok;
    reject = bad;
  });
  return { promise, resolve, reject };
}

function seedTasks(client: QueryClient, tasks: readonly SidebarTask[]) {
  client.setQueryData(queryKeys.sidebar.tasks.list(projectScope), {
    taskIds: tasks.map(({ id }) => id),
    relationships: tasks.map(({ id, linkedThreadIds }) => ({
      taskId: id,
      linkedThreadIds,
    })),
  });
  client.setQueryData<TaskFactDirectory>(
    queryKeys.sidebar.tasks.facts(projectScope),
    {
      projectId: projectScope,
      facts: Object.fromEntries(
        tasks.map(({ linkedThreadIds: _linkedThreadIds, ...fact }) => [
          fact.id,
          fact,
        ]),
      ),
    },
  );
}

function readFact(client: QueryClient, taskId: string): TaskFact | undefined {
  return client.getQueryData<TaskFactDirectory>(
    queryKeys.sidebar.tasks.facts(projectScope),
  )?.facts[taskId];
}

function invalidatedFamily(queryKey: readonly unknown[]): string {
  if (queryKey.includes("list")) return "list";
  if (queryKey.includes("links")) return "links";
  return "outcome";
}

function setup(rpc: { call: ReturnType<typeof vi.fn> }) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  seedTasks(client, [task]);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return {
    client,
    hook: renderHook(() => useTasksMutations(rpc as never, projectScope), {
      wrapper,
    }),
  };
}

describe("Tasks mutations", () => {
  it("cancels, snapshots, projects, rolls back, and settles assignment in order", async () => {
    const pending = deferred<unknown>();
    const rpc = { call: vi.fn(() => pending.promise) };
    const { client, hook } = setup(rpc);
    const cancel = vi.spyOn(client, "cancelQueries");
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const run = hook.result.current.assignment.mutateAsync({
      taskId: task.id,
      assignee: "agent",
    });
    await waitFor(() => expect(readFact(client, task.id)?.assignee).toBe("agent"));
    expect(cancel).toHaveBeenCalledWith({
      queryKey: queryKeys.sidebar.tasks.list(projectScope),
    });
    expect(invalidate).not.toHaveBeenCalled();
    pending.reject(new Error("nope"));
    await expect(run).rejects.toThrow("nope");
    expect(readFact(client, task.id)?.assignee).toBe("human");
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.sidebar.tasks.list(projectScope),
    });
  });

  it("keeps invalidation client-local and never projects non-reversible mutations", async () => {
    const rpc = {
      call: vi.fn((method: string) =>
        method === "deleteSidebarTask"
          ? Promise.resolve({ deleted: false })
          : Promise.resolve({}),
      ),
    };
    const { client, hook } = setup(rpc);
    const before = client.getQueryData(
      queryKeys.sidebar.tasks.facts(projectScope),
    );
    const other = new QueryClient();
    const invalidation = vi.spyOn(other, "invalidateQueries");
    await invalidateTaskQueries(other, ["links"]);
    expect(invalidation).toHaveBeenCalledWith({
      queryKey: queryKeys.sidebar.tasks.links(),
    });
    await hook.result.current.create.mutateAsync({
      projectId: "project_1",
      title: "New",
      assignee: "human",
    });
    await hook.result.current.attachment.mutateAsync({
      taskId: task.id,
      threadId: "thr_1",
      attached: true,
    });
    await hook.result.current.status.mutateAsync({
      taskId: task.id,
      status: "done",
    });
    await expect(
      hook.result.current.remove.mutateAsync({ taskId: task.id }),
    ).rejects.toThrow("Task was not found.");
    expect(
      client.getQueryData(queryKeys.sidebar.tasks.facts(projectScope)),
    ).toEqual(before);
  });

  it("defers one realtime list+links flush until overlapping assignment and reorder settle", async () => {
    const assign = deferred<unknown>();
    const reorder = deferred<unknown>();
    const rpc = {
      call: vi.fn((method: string) =>
        method === "updateTaskAssignee"
          ? assign.promise
          : method === "reorderTask"
            ? reorder.promise
            : Promise.resolve({}),
      ),
    };
    const { client, hook } = setup(rpc);
    seedTasks(client, [task, { ...task, id: "task_2", position: 2 }]);
    const invalidations: string[] = [];
    const isMutating = vi.spyOn(client, "isMutating");
    vi.spyOn(client, "invalidateQueries").mockImplementation(async (filters) => {
      invalidations.push(invalidatedFamily(filters?.queryKey ?? []));
    });
    const assignment = hook.result.current.assignment.mutateAsync({
      taskId: task.id,
      assignee: "agent",
    });
    const move = hook.result.current.reorder.mutateAsync({
      taskId: task.id,
      beforeTaskId: "task_2",
      afterTaskId: null,
    });
    await waitFor(() => expect(rpc.call).toHaveBeenCalledTimes(2));
    expect(client.isMutating({ mutationKey: taskOptimisticMutationKey })).toBe(2);
    await invalidateTaskQueries(client, ["list", "links"]);
    expect(invalidations).toEqual([]);
    expect(isMutating).toHaveBeenCalledWith({
      mutationKey: taskOptimisticMutationKey,
    });
    assign.resolve({});
    await assignment;
    expect(client.isMutating({ mutationKey: taskOptimisticMutationKey })).toBe(1);
    expect(invalidations).toEqual([]);
    reorder.resolve({});
    await move;
    expect(client.isMutating({ mutationKey: taskOptimisticMutationKey })).toBe(0);
    expect(invalidations.sort()).toEqual(["links", "list", "outcome"]);
  });

  it("rolls back only the failed projection while a different optimistic mutation remains", async () => {
    const assignment = deferred<unknown>();
    const reorder = deferred<unknown>();
    const rpc = {
      call: vi.fn((method: string) =>
        method === "updateTaskAssignee"
          ? assignment.promise
          : method === "reorderTask"
            ? reorder.promise
            : Promise.resolve({}),
      ),
    };
    const { client, hook } = setup(rpc);
    seedTasks(client, [task, { ...task, id: "task_2", position: 2 }]);
    const assign = hook.result.current.assignment.mutateAsync({
      taskId: task.id,
      assignee: "agent",
    });
    const move = hook.result.current.reorder.mutateAsync({
      taskId: "task_2",
      beforeTaskId: task.id,
      afterTaskId: null,
    });
    await waitFor(() => expect(rpc.call).toHaveBeenCalledTimes(2));
    assignment.reject(new Error("assignment failed"));
    await expect(assign).rejects.toThrow("assignment failed");
    expect(readFact(client, task.id)).toMatchObject({
      assignee: "human",
      position: 2048,
    });
    expect(readFact(client, "task_2")).toMatchObject({ position: 1024 });
    reorder.reject(new Error("reorder failed"));
    await expect(move).rejects.toThrow("reorder failed");
    expect(readFact(client, task.id)).toMatchObject({
      assignee: "human",
      position: 1,
    });
    expect(readFact(client, "task_2")).toMatchObject({ position: 2 });
  });

  it("preserves assignment when a concurrent reorder fails and serializes same-kind assignments", async () => {
    const assignment = deferred<unknown>();
    const reorder = deferred<unknown>();
    const rpc = {
      call: vi.fn((method: string) =>
        method === "updateTaskAssignee"
          ? assignment.promise
          : method === "reorderTask"
            ? reorder.promise
            : Promise.resolve({}),
      ),
    };
    const { client, hook } = setup(rpc);
    seedTasks(client, [task, { ...task, id: "task_2", position: 2 }]);
    const assign = hook.result.current.assignment.mutateAsync({
      taskId: task.id,
      assignee: "agent",
    });
    const move = hook.result.current.reorder.mutateAsync({
      taskId: "task_2",
      beforeTaskId: task.id,
      afterTaskId: null,
    });
    await waitFor(() => expect(rpc.call).toHaveBeenCalledTimes(2));
    reorder.reject(new Error("reorder failed"));
    await expect(move).rejects.toThrow("reorder failed");
    expect(readFact(client, task.id)).toMatchObject({
      assignee: "agent",
      position: 1,
    });
    assignment.resolve({});
    await assign;

    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const serialRpc = {
      call: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise),
    };
    const serial = setup(serialRpc);
    const one = serial.hook.result.current.assignment
      .mutateAsync({ taskId: task.id, assignee: "agent" })
      .catch((error) => error);
    const two = serial.hook.result.current.assignment.mutateAsync({
      taskId: task.id,
      assignee: "human",
    });
    await waitFor(() => expect(serialRpc.call).toHaveBeenCalledTimes(1));
    first.reject(new Error("first failed"));
    await one;
    await waitFor(() => expect(serialRpc.call).toHaveBeenCalledTimes(2));
    second.resolve({});
    await two;
  });

  it("keeps concurrent realtime deferral independent for each QueryClient", async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const one = setup({ call: vi.fn(() => first.promise) });
    const two = setup({ call: vi.fn(() => second.promise) });
    const oneInvalidations: string[] = [];
    const twoInvalidations: string[] = [];
    vi.spyOn(one.client, "invalidateQueries").mockImplementation(async (filters) => {
      oneInvalidations.push(invalidatedFamily(filters?.queryKey ?? []));
    });
    vi.spyOn(two.client, "invalidateQueries").mockImplementation(async (filters) => {
      twoInvalidations.push(invalidatedFamily(filters?.queryKey ?? []));
    });
    const oneRun = one.hook.result.current.assignment.mutateAsync({
      taskId: task.id,
      assignee: "agent",
    });
    const twoRun = two.hook.result.current.assignment.mutateAsync({
      taskId: task.id,
      assignee: "agent",
    });
    await waitFor(() =>
      expect(one.client.isMutating({ mutationKey: taskOptimisticMutationKey })).toBe(1),
    );
    await waitFor(() =>
      expect(two.client.isMutating({ mutationKey: taskOptimisticMutationKey })).toBe(1),
    );
    await invalidateTaskQueries(one.client, ["links"]);
    await invalidateTaskQueries(two.client, ["list"]);
    expect(oneInvalidations).toEqual([]);
    expect(twoInvalidations).toEqual([]);
    first.resolve({});
    await oneRun;
    expect(oneInvalidations.sort()).toEqual(["links", "list", "outcome"]);
    expect(twoInvalidations).toEqual([]);
    second.resolve({});
    await twoRun;
    expect(twoInvalidations.sort()).toEqual(["list", "outcome"]);
  });
});

import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  evaluateThreadHierarchyMove,
  type HierarchyBinding,
  type HierarchyThread,
} from "./hierarchy-model.js";
import type { SidebarThreadGroupPreferences } from "./model.js";
import type { createThreadPreferencesService } from "./server.js";

export type WorkBindingReader = {
  bindings(): Promise<StoredWorkBindings>;
  allTasksById(): Promise<Map<string, { key: string }>>;
};

type StoredWorkBindings = Readonly<{
  outcomes: readonly Readonly<{
    rootThreadId: string;
    outcomeTaskId: string;
  }>[];
  executions: readonly Readonly<{
    rootThreadId: string;
    ownerThreadId: string | null;
    executionTaskId: string;
  }>[];
}>;

type ThreadHierarchyDependencies = Readonly<{
  getThread(threadId: string): Promise<HierarchyThread | null>;
  listThreads(projectId: string): Promise<HierarchyThread[]>;
  updateThread(input: {
    threadId: string;
    parentThreadId: string | null;
  }): Promise<unknown>;
  readBindings(): Promise<StoredWorkBindings>;
  taskKey(taskId: string): Promise<string | null>;
  readGroups(): Promise<SidebarThreadGroupPreferences>;
  saveGroups(
    groups: SidebarThreadGroupPreferences["groups"],
    activeGroupPosition: number,
  ): Promise<unknown>;
  publishWork(rootThreadId: string): void;
}>;

const HIERARCHY_LIST_LIMIT = 2_000;
const HIERARCHY_NOT_FULLY_LOADED =
  "The thread hierarchy is not fully loaded. Refresh the sidebar and try again.";

async function projectBindings(
  stored: StoredWorkBindings,
  taskKey: ThreadHierarchyDependencies["taskKey"],
): Promise<HierarchyBinding[]> {
  return Promise.all([
    ...stored.outcomes.map(async (binding): Promise<HierarchyBinding> => ({
      kind: "outcome",
      rootThreadId: binding.rootThreadId,
      ownerThreadId: binding.rootThreadId,
      taskKey:
        (await taskKey(binding.outcomeTaskId)) ?? binding.outcomeTaskId,
    })),
    ...stored.executions.flatMap((binding) =>
      binding.ownerThreadId
        ? [
            (async (): Promise<HierarchyBinding> => ({
              kind: "execution",
              rootThreadId: binding.rootThreadId,
              ownerThreadId: binding.ownerThreadId!,
              taskKey:
                (await taskKey(binding.executionTaskId)) ??
                binding.executionTaskId,
            }))(),
          ]
        : [],
    ),
  ]);
}

/** Owns the validated SDK write and its top-level group reconciliation. */
export function createThreadHierarchyService(
  dependencies: ThreadHierarchyDependencies,
) {
  return {
    async move({
      threadId,
      parentThreadId,
    }: {
      threadId: string;
      parentThreadId: string | null;
    }) {
      const source = await dependencies.getThread(threadId);
      if (!source) throw new Error("The thread is no longer available.");
      const parent = parentThreadId
        ? await dependencies.getThread(parentThreadId)
        : null;
      const listed = await dependencies.listThreads(source.projectId);
      if (listed.length >= HIERARCHY_LIST_LIMIT)
        throw new Error(HIERARCHY_NOT_FULLY_LOADED);
      const threads = new Map(listed.map((thread) => [thread.id, thread]));
      threads.set(source.id, source);
      if (parent) threads.set(parent.id, parent);
      const bindings = await projectBindings(
        await dependencies.readBindings(),
        dependencies.taskKey,
      );
      const decision = evaluateThreadHierarchyMove({
        threads: [...threads.values()],
        bindings,
        sourceThreadId: threadId,
        parentThreadId,
      });
      if (!decision.allowed) throw new Error(decision.message);

      const preferences = await dependencies.readGroups();
      const affected = new Set(decision.affectedThreadIds);
      const groups = preferences.groups.map((group) => ({
        ...group,
        threadIds: group.threadIds.filter((id) => !affected.has(id)),
      }));
      await dependencies.updateThread({ threadId, parentThreadId });
      try {
        await dependencies.saveGroups(
          groups,
          preferences.activeGroupPosition,
        );
      } catch (error) {
        try {
          await dependencies.updateThread({
            threadId,
            parentThreadId: source.parentThreadId,
          });
        } catch (rollbackError) {
          const message =
            error instanceof Error ? error.message : String(error);
          const rollbackMessage =
            rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError);
          throw new Error(
            `${message}. Restoring the original hierarchy also failed: ${rollbackMessage}`,
          );
        }
        throw error;
      }
      for (const rootThreadId of new Set([
        decision.oldRootThreadId,
        decision.newRootThreadId,
      ]))
        dependencies.publishWork(rootThreadId);
      return {
        threadId,
        parentThreadId,
        oldRootThreadId: decision.oldRootThreadId,
        newRootThreadId: decision.newRootThreadId,
        affectedThreadIds: decision.affectedThreadIds,
      };
    },
  };
}

/** Adapts BB SDK records at the server-only Threads boundary. */
export function createSdkThreadHierarchyService(
  bb: BbPluginApi,
  work: WorkBindingReader,
  preferences: Pick<
    ReturnType<typeof createThreadPreferencesService>,
    "groups" | "saveGroups"
  >,
) {
  return createThreadHierarchyService({
    async getThread(threadId) {
      const thread = await bb.sdk.threads.get({ threadId });
      return {
        id: thread.id,
        projectId: thread.projectId,
        parentThreadId: thread.parentThreadId,
        isArchived: thread.archivedAt !== null,
        title: thread.title ?? thread.titleFallback ?? "Untitled thread",
      };
    },
    async listThreads(projectId) {
      const threads = await bb.sdk.threads.list({
        projectId,
        archived: false,
        includeHidden: true,
        limit: HIERARCHY_LIST_LIMIT,
      });
      return threads.map((thread) => ({
        id: thread.id,
        projectId: thread.projectId,
        parentThreadId: thread.parentThreadId,
        isArchived: thread.archivedAt !== null,
        title: thread.title ?? thread.titleFallback ?? "Untitled thread",
      }));
    },
    updateThread: (input) => bb.sdk.threads.update(input),
    readBindings: work.bindings,
    async taskKey(taskId) {
      return (await work.allTasksById()).get(taskId)?.key ?? null;
    },
    readGroups: preferences.groups,
    saveGroups: preferences.saveGroups,
    publishWork: (rootThreadId) =>
      bb.realtime.publish("work-sidebar:changed", {
        family: "work",
        rootThreadId,
      }),
  });
}

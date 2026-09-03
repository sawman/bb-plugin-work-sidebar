import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  assertExecutionTaskBinding,
  assertOutcomeTaskBinding,
  assertThreadEnvironmentProject,
  projectPrefix,
  summarizeTask,
  resolveProjectSelection,
} from "./server-model.js";
import {
  bindExecutionOwner,
  executionBindingDispatchProblem,
  normalizeBindings,
  type BindingMode,
  type DispatchState,
  type ExecutionBinding,
  type OutcomeBinding,
  type WorkBindings,
} from "../work-context/server-bindings.js";
import {
  createTasksPluginAdapter,
  type Task,
  type TaskSummary,
  taskMutationSchema,
  taskThreadSchema,
} from "./server-task-adapter.js";
import type { LegacyWorkContext, ServerLifecycle } from "../../server-lifecycle.js";

export const WORK_BINDINGS_KEY = "work-bindings:v2";
export const LEGACY_DISCOVERY_TTL_MS = 5_000;
export const LEGACY_DISCOVERY_CONCURRENCY = 8;
const WORK_BINDINGS_MIGRATION_KEY = "legacy-kv-v2-imported";
// Terminal executions belong to BB Tasks, not the small dispatch-recovery
// sidecar. Compact an old import once it grows beyond a practical recovery set.
const WORK_BINDINGS_COMPACTION_THRESHOLD = 64;
const workBindingsMigrations = [
  `CREATE TABLE IF NOT EXISTS work_binding_state (
     singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
     bindings_json TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE TABLE IF NOT EXISTS work_binding_metadata (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   );`,
];
type TasksPluginAdapter = ReturnType<typeof createTasksPluginAdapter>;
export type WorkBindingsState = Pick<WorkBindings, "outcomes" | "executions">;
export type StableLegacyContext = {
  bindings: WorkBindings;
  legacy: LegacyContext;
};
export type BindingSummary = {
  rootThreadId: string;
  outcomeTaskId: string;
  taskProjectId: string;
  executionTaskId: string | null;
  ownerThreadId: string | null;
  mode: BindingMode | null;
  idempotencyKey: string | null;
  dispatchState: DispatchState;
  recoveryMessage: string | null;
};
export type TaskLink = {
  task: TaskSummary;
  threadId: string;
  threadTitle: string;
  liveStatus: z.infer<typeof taskThreadSchema>["liveStatus"];
  role: "outcome" | "execution";
  mode: BindingMode | null;
  idempotencyKey: string | null;
  dispatchState: DispatchState | null;
};
export type LegacyContext = LegacyWorkContext;
export type DescendantThread = {
  thread: Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["list"]>>[number];
  depth: number;
};

type WorkBindingsRealtime = Pick<BbPluginApi["realtime"], "publish">;

/** Announces root-scoped Work data before the matching root Tasks projection. */
export function publishWorkBindingReady(
  realtime: WorkBindingsRealtime,
  rootThreadId: string,
) {
  realtime.publish("work-sidebar:changed", {
    family: "work",
    rootThreadId,
  });
  realtime.publish("work-sidebar:changed", {
    family: "tasks",
    threadId: rootThreadId,
  });
}

type WorkBindingReadyFinalization = {
  pending: ExecutionBinding;
  mode: BindingMode;
  ownerThreadId: string;
  rootThreadId: string;
  spawnedThreadId: string | null;
  realtime: WorkBindingsRealtime;
  save: (binding: ExecutionBinding) => Promise<ExecutionBinding>;
};

/** Persists and announces any successfully attached direct or delegated owner. */
export async function finalizeWorkBindingOwner({
  pending,
  mode,
  ownerThreadId,
  rootThreadId,
  spawnedThreadId,
  realtime,
  save,
}: WorkBindingReadyFinalization) {
  const binding = await save(
    bindExecutionOwner(pending, mode, ownerThreadId, "ready", null),
  );
  publishWorkBindingReady(realtime, rootThreadId);
  return { binding, spawnedThreadId };
}

function legacyWorkKey(rootThreadId: string, projectId: string): string {
  return `${rootThreadId}\u0000${projectId}`;
}

async function readBounded<T, Result>(
  values: readonly T[],
  read: (value: T) => Promise<Result>,
): Promise<Result[]> {
  const results = new Array<Result>(values.length);
  let next = 0;
  const worker = async () => {
    while (next < values.length) {
      const index = next;
      next += 1;
      results[index] = await read(values[index]!);
    }
  };
  await Promise.all(
    Array.from(
      { length: Math.min(LEGACY_DISCOVERY_CONCURRENCY, values.length) },
      worker,
    ),
  );
  return results;
}

/** Durable outcome/execution ownership, dispatch recovery, and legacy adoption. */
export function createWorkBindingsService(
  bb: BbPluginApi,
  tasks: TasksPluginAdapter,
  lifecycle: ServerLifecycle,
) {
  const database = bb.storage.database();
  bb.storage.migrate(database, workBindingsMigrations);
  let compaction: Promise<WorkBindings> | null = null;
  let migration: Promise<void> | null = null;
  const readDatabase = (): WorkBindings => {
    const row = database
      .prepare<[], { bindings_json: string }>(
        "SELECT bindings_json FROM work_binding_state WHERE singleton = 1",
      )
      .get();
    if (!row) return normalizeBindings(undefined);
    try {
      return normalizeBindings(JSON.parse(row.bindings_json));
    } catch {
      return normalizeBindings(undefined);
    }
  };
  const writeDatabase = (bindings: WorkBindings) => {
    database
      .prepare(
        `INSERT INTO work_binding_state (singleton, bindings_json, updated_at)
         VALUES (1, ?, ?)
         ON CONFLICT(singleton) DO UPDATE SET
           bindings_json = excluded.bindings_json,
           updated_at = excluded.updated_at`,
      )
      .run(JSON.stringify(bindings), new Date().toISOString());
  };
  const legacyMigrationComplete = () =>
    Boolean(
      database
        .prepare<[string], { value: string }>(
          "SELECT value FROM work_binding_metadata WHERE key = ?",
        )
        .get(WORK_BINDINGS_MIGRATION_KEY),
    );
  const ensureMigrated = async () => {
    if (!migration) {
      migration = (async () => {
        if (legacyMigrationComplete()) return;
        const legacy = normalizeBindings(
          await bb.storage.kv.get<unknown>(WORK_BINDINGS_KEY),
        );
        if (legacy.outcomes.length || legacy.executions.length)
          writeDatabase(legacy);
        database
          .prepare(
            `INSERT INTO work_binding_metadata (key, value)
             VALUES (?, ?)
             ON CONFLICT(key) DO NOTHING`,
          )
          .run(WORK_BINDINGS_MIGRATION_KEY, new Date().toISOString());
        await bb.storage.kv.delete(WORK_BINDINGS_KEY);
      })();
    }
    await migration;
  };
  const compactTerminalExecutions = async (saved: WorkBindings) => {
    if (saved.executions.length < WORK_BINDINGS_COMPACTION_THRESHOLD) return saved;

    const tasksById = await tasks.allTasksById();
    const executions = saved.executions.filter((binding) => {
      const task = tasksById.get(binding.executionTaskId);
      // A missing task and every unresolved dispatch retain their durable
      // recovery path. Only a completed/canceled, fully-ready task is history.
      return (
        binding.dispatchState !== "ready" ||
        !task ||
        (task.status !== "done" && task.status !== "canceled")
      );
    });
    if (executions.length === saved.executions.length) return saved;
    const compacted = {
      outcomes: saved.outcomes,
      executions,
    };
    writeDatabase(compacted);
    return compacted;
  };
  const read = async (): Promise<WorkBindings> => {
    await ensureMigrated();
    const saved = readDatabase();
    if (saved.executions.length < WORK_BINDINGS_COMPACTION_THRESHOLD)
      return saved;

    if (!compaction) {
      compaction = compactTerminalExecutions(saved).finally(() => {
        compaction = null;
      });
    }
    try {
      await compaction;
      return readDatabase();
    } catch {
      // A Tasks outage must not turn an otherwise-readable Work panel into an
      // error. A later successful read can compact the same snapshot.
      return saved;
    }
  };
  const write = async (bindings: WorkBindings) => {
    await ensureMigrated();
    writeDatabase(bindings);
  };
  const pruneTerminalExecution = async (taskId: string) => {
    const saved = await read();
    const executions = saved.executions.filter(
      (binding) =>
        binding.executionTaskId !== taskId || binding.dispatchState !== "ready",
    );
    if (executions.length !== saved.executions.length)
      await write({ outcomes: saved.outcomes, executions });
  };
  const persistAssignee = async (
    taskId: string,
    assignee: "agent" | "human" | undefined,
  ) => {
    if (!assignee) return false;
    const stored = (await tasks.readAssignees())[taskId];
    if (stored !== assignee) await tasks.writeAssignee(taskId, assignee);
    return (stored ?? "human") !== assignee;
  };
  const publishTaskAssignment = (rootThreadId: string) =>
    bb.realtime.publish("work-sidebar:changed", {
      family: "tasks",
      threadId: rootThreadId,
    });
  const rootThread = async (threadId: string) => {
    let thread = await bb.sdk.threads.get({ threadId });
    for (let depth = 0; thread.parentThreadId && depth < 32; depth += 1) {
      thread = await bb.sdk.threads.get({ threadId: thread.parentThreadId });
    }
    if (thread.parentThreadId)
      throw new Error("Thread parent chain is too deep to resolve a work root");
    return thread;
  };
  const descendants = async (
    parentThreadId: string,
    depth = 0,
  ): Promise<DescendantThread[]> => {
    if (depth >= 8) return [];
    const direct = await bb.sdk.threads.list({
      parentThreadId,
      includeHidden: true,
      limit: 100,
    });
    const nested = await Promise.all(
      direct.map((child) => descendants(child.id, depth + 1)),
    );
    return [
      ...direct.map((thread) => ({ thread, depth: depth + 1 })),
      ...nested.flat(),
    ];
  };
  const summarize = (
    binding: OutcomeBinding | ExecutionBinding,
  ): BindingSummary => ({
    rootThreadId: binding.rootThreadId,
    outcomeTaskId: binding.outcomeTaskId,
    taskProjectId: binding.taskProjectId,
    executionTaskId:
      binding.kind === "execution" ? binding.executionTaskId : null,
    ownerThreadId: binding.kind === "execution" ? binding.ownerThreadId : null,
    mode: binding.kind === "execution" ? binding.mode : null,
    idempotencyKey:
      binding.kind === "execution" ? binding.idempotencyKey : null,
    dispatchState:
      binding.kind === "execution" ? binding.dispatchState : "ready",
    recoveryMessage:
      binding.kind === "execution" ? binding.recoveryMessage : null,
  });
  const links = async (): Promise<Record<string, TaskLink[]>> => {
    const saved = await read();
    const [byId, projects] = await Promise.all([
      tasks.allTasksById(),
      tasks.projects(),
    ]);
    const names = new Map(
      projects.map((project) => [project.id, project.name]),
    );
    const output: Record<string, TaskLink[]> = {};
    const add = (
      threadId: string,
      threadTitle: string,
      task: Task,
      liveStatus: TaskLink["liveStatus"],
      role: TaskLink["role"],
      mode: BindingMode | null,
      idempotencyKey: string | null,
      dispatchState: DispatchState | null,
    ) => {
      (output[threadId] ??= []).push({
        task: summarizeTask(task, names.get(task.projectId) ?? "Work"),
        threadId,
        threadTitle,
        liveStatus,
        role,
        mode,
        idempotencyKey,
        dispatchState,
      });
    };
    for (const outcome of saved.outcomes) {
      const task = byId.get(outcome.outcomeTaskId);
      if (!task) continue;
      const rows = await tasks.call(
        "listTaskThreads",
        { taskId: task.id },
        z.object({ taskThreads: z.array(taskThreadSchema) }),
      );
      for (const row of rows.taskThreads.filter(
        (row) => row.threadId === outcome.rootThreadId,
      ))
        add(
          row.threadId,
          row.title,
          task,
          row.liveStatus,
          "outcome",
          null,
          null,
          null,
        );
    }
    for (const execution of saved.executions) {
      const task = byId.get(execution.executionTaskId);
      if (!task || !execution.ownerThreadId) continue;
      const rows = await tasks.call(
        "listTaskThreads",
        { taskId: task.id },
        z.object({ taskThreads: z.array(taskThreadSchema) }),
      );
      for (const row of rows.taskThreads.filter(
        (row) => row.threadId === execution.ownerThreadId,
      ))
        add(
          row.threadId,
          row.title,
          task,
          row.liveStatus,
          "execution",
          execution.mode,
          execution.idempotencyKey,
          execution.dispatchState,
        );
    }
    return output;
  };
  const projectFor = async (
    thread: Awaited<ReturnType<typeof rootThread>>,
    options: {
      explicitTaskProjectId?: string | null;
      parentOutcome?: OutcomeBinding | null;
      createIfMissing: boolean;
    },
  ) => {
    const environmentProjectId = thread.environmentId
      ? (await bb.sdk.environments.get({ environmentId: thread.environmentId }))
          .projectId
      : null;
    const projects = await tasks.projects();
    const selected = resolveProjectSelection(
      projects,
      thread.projectId,
      {
        explicitTaskProjectId: options.explicitTaskProjectId,
        parentTaskProjectId: options.parentOutcome?.taskProjectId,
      },
      environmentProjectId && environmentProjectId !== thread.projectId
        ? [environmentProjectId]
        : [],
    );
    const selectedProject = selected
      ? (projects.find((project) => project.id === selected) ?? null)
      : null;
    if (environmentProjectId)
      assertThreadEnvironmentProject(
        thread.projectId,
        environmentProjectId,
        selectedProject?.linkedBbProjectId
          ? [selectedProject.linkedBbProjectId]
          : [],
      );
    if (selected) return selected;
    if (!options.createIfMissing)
      throw new Error(
        `No Tasks project is linked to BB project ${thread.projectId}`,
      );
    const bbProject = (
      await bb.sdk.projects.list({ includePersonal: true })
    ).find((project) => project.id === thread.projectId);
    if (!bbProject)
      throw new Error(`BB project not found: ${thread.projectId}`);
    const created = await tasks.call(
      "createProject",
      {
        name: bbProject.name,
        prefix: projectPrefix(
          bbProject.name,
          thread.projectId,
          new Set(projects.map((project) => project.prefix)),
        ),
        color: "blue",
        folderId: null,
        linkedBbProjectId: thread.projectId,
      },
      z.object({ project: z.object({ id: z.string() }) }),
    );
    const verified = (await tasks.projects()).filter(
      (project) => project.linkedBbProjectId === thread.projectId,
    );
    if (verified.length !== 1 || verified[0]?.id !== created.project.id)
      throw new Error(
        `Tasks project mapping changed while creating the mapping for ${thread.projectId}; resolve the duplicate mapping before retrying`,
      );
    return created.project.id;
  };
  const legacy = async (
    rootThreadId: string,
    projectId: string,
  ): Promise<LegacyContext> => {
    return lifecycle.readLegacyWork(
      legacyWorkKey(rootThreadId, projectId),
      LEGACY_DISCOVERY_TTL_MS,
      async () => {
        const [all, projects] = await Promise.all([
          tasks.listAll({ activeOnly: false, sort: "manual" }),
          tasks.projects(),
        ]);
        const candidates = (
          await readBounded(
            all.filter((candidate) => candidate.parentTaskId === null),
            async (task) => {
              const rows = await tasks.call(
                "listTaskThreads",
                { taskId: task.id },
                z.object({ taskThreads: z.array(taskThreadSchema) }),
              );
              return rows.taskThreads.some((row) => row.threadId === rootThreadId)
                ? task
                : null;
            },
          )
        ).flatMap((task) => task ? [task] : []);
        if (!candidates.length)
          return { state: "none", taskIds: [], message: null };
        if (
          candidates.some(
            (task) =>
              projects.find((project) => project.id === task.projectId)
                ?.linkedBbProjectId !== projectId,
          )
        ) {
          return {
            state: "project_mismatch",
            taskIds: candidates.map((task) => task.id),
            message:
              "Legacy attachment is linked to a different BB project and cannot be adopted.",
          };
        }
        if (candidates.length !== 1) {
          return {
            state: "ambiguous",
            taskIds: candidates.map((task) => task.id),
            message:
              "Several legacy top-level tasks are attached; select one explicitly to adopt.",
          };
        }
        return {
          state: "adoptable",
          taskIds: [candidates[0].id],
          message: "One legacy top-level attachment can be explicitly adopted.",
        };
      },
    );
  };
  const invalidateLegacy = (rootThreadId: string, projectId: string) =>
    lifecycle.invalidateLegacyWork(legacyWorkKey(rootThreadId, projectId));
  const sameRootBindings = (
    first: WorkBindings,
    second: WorkBindings,
    rootThreadId: string,
  ) =>
    JSON.stringify({
      outcomes: first.outcomes.filter(
        (binding) => binding.rootThreadId === rootThreadId,
      ),
      executions: first.executions.filter(
        (binding) => binding.rootThreadId === rootThreadId,
      ),
    }) ===
    JSON.stringify({
      outcomes: second.outcomes.filter(
        (binding) => binding.rootThreadId === rootThreadId,
      ),
      executions: second.executions.filter(
        (binding) => binding.rootThreadId === rootThreadId,
      ),
    });
  const context = async (
    rootThreadId: string,
    projectId: string,
    retriesRemaining = 1,
  ): Promise<StableLegacyContext> => {
    const saved = await read();
    const outcome = saved.outcomes.some(
      (binding) => binding.rootThreadId === rootThreadId,
    );
    if (outcome)
      return {
        bindings: saved,
        legacy: { state: "none", taskIds: [], message: null },
      };
    const candidate = await legacy(rootThreadId, projectId);
    const current = await read();
    if (sameRootBindings(saved, current, rootThreadId))
      return { bindings: current, legacy: candidate };
    if (!retriesRemaining)
      throw new Error(
        "Work bindings changed repeatedly while resolving legacy context. Retry the operation.",
      );
    return context(rootThreadId, projectId, retriesRemaining - 1);
  };
  const outcome = async (input: {
    rootThreadId: string;
    title: string;
    description: string;
    taskProjectId?: string | null;
    assignee?: "agent" | "human";
    priority?: Task["priority"];
  }) => {
    if (!(await tasks.available()))
      throw new Error("The official BB Tasks plugin is not available");
    const root = await rootThread(input.rootThreadId);
    if (root.parentThreadId)
      throw new Error("Outcomes may only be created for a root work thread");
    const saved = await read();
    const existing = saved.outcomes.find(
      (binding) => binding.rootThreadId === root.id,
    );
    const all = await tasks.allTasksById();
    if (existing) {
      const task = all.get(existing.outcomeTaskId);
      if (!task)
        throw new Error(
          `Outcome binding ${existing.outcomeTaskId} is missing; resolve recovery before creating another outcome`,
        );
      assertOutcomeTaskBinding(existing, task);
      if (await persistAssignee(task.id, input.assignee))
        publishTaskAssignment(root.id);
      return { task, binding: existing };
    }
    const taskProjectId = await projectFor(root, {
      explicitTaskProjectId: input.taskProjectId,
      createIfMissing: true,
    });
    const result = await tasks.call(
      "createTask",
      {
        projectId: taskProjectId,
        title: input.title,
        description: input.description,
        status: "in_progress",
        priority: input.priority ?? "medium",
        dueDate: null,
        parentTaskId: null,
        labelIds: [],
      },
      taskMutationSchema,
    );
    if (!result.ok) throw new Error(result.error.message);
    if (
      result.task.parentTaskId !== null ||
      result.task.projectId !== taskProjectId
    )
      throw new Error(
        "Outcome creation did not return the requested top-level Tasks task",
      );
    await tasks.call(
      "taskThreadsAttach",
      { taskId: result.task.id, threadId: root.id },
      z.object({ threadId: z.string() }),
    );
    const now = new Date().toISOString();
    const binding: OutcomeBinding = {
      kind: "outcome",
      rootThreadId: root.id,
      outcomeTaskId: result.task.id,
      taskProjectId,
      createdAt: now,
      updatedAt: now,
    };
    await write({ ...saved, outcomes: [...saved.outcomes, binding] });
    await persistAssignee(result.task.id, input.assignee);
    invalidateLegacy(root.id, root.projectId);
    publishWorkBindingReady(bb.realtime, root.id);
    return { task: result.task, binding };
  };
  const execution = async (input: {
    rootThreadId: string;
    title: string;
    description: string;
    idempotencyKey: string;
    assignee?: "agent" | "human";
  }) => {
    const root = await rootThread(input.rootThreadId);
    const saved = await read();
    const outcomeBinding = saved.outcomes.find(
      (binding) => binding.rootThreadId === root.id,
    );
    if (!outcomeBinding)
      throw new Error(
        "Ensure an outcome context before creating an execution task",
      );
    const all = await tasks.allTasksById();
    const existing = saved.executions.find(
      (binding) =>
        binding.rootThreadId === root.id &&
        binding.idempotencyKey === input.idempotencyKey,
    );
    if (existing) {
      const task = all.get(existing.executionTaskId);
      if (!task)
        throw new Error(
          `Execution binding ${existing.executionTaskId} is missing; recovery is required`,
        );
      assertExecutionTaskBinding(existing, task);
      if (await persistAssignee(task.id, input.assignee))
        publishTaskAssignment(root.id);
      return { task, binding: existing, reused: true };
    }
    const outcomeTask = all.get(outcomeBinding.outcomeTaskId);
    if (!outcomeTask)
      throw new Error(
        `Outcome binding ${outcomeBinding.outcomeTaskId} is missing; recovery is required`,
      );
    assertOutcomeTaskBinding(outcomeBinding, outcomeTask);
    const taskProjectId = await projectFor(root, {
      parentOutcome: outcomeBinding,
      createIfMissing: false,
    });
    const result = await tasks.call(
      "createTask",
      {
        projectId: taskProjectId,
        title: input.title,
        description: input.description,
        status: "todo",
        priority: "medium",
        dueDate: null,
        parentTaskId: outcomeBinding.outcomeTaskId,
        labelIds: [],
      },
      taskMutationSchema,
    );
    if (!result.ok) throw new Error(result.error.message);
    if (
      result.task.parentTaskId !== outcomeBinding.outcomeTaskId ||
      result.task.projectId !== taskProjectId
    )
      throw new Error(
        "Execution task must be a direct child in the outcome project",
      );
    const now = new Date().toISOString();
    const binding: ExecutionBinding = {
      kind: "execution",
      rootThreadId: root.id,
      outcomeTaskId: outcomeBinding.outcomeTaskId,
      taskProjectId,
      executionTaskId: result.task.id,
      ownerThreadId: null,
      mode: null,
      idempotencyKey: input.idempotencyKey,
      dispatchState: "ready",
      recoveryMessage: null,
      createdAt: now,
      updatedAt: now,
    };
    await write({ ...saved, executions: [...saved.executions, binding] });
    await persistAssignee(result.task.id, input.assignee);
    invalidateLegacy(root.id, root.projectId);
    publishWorkBindingReady(bb.realtime, root.id);
    return { task: result.task, binding, reused: false };
  };
  const owner = async (input: {
    rootThreadId: string;
    idempotencyKey: string;
    mode: BindingMode;
    prompt?: string;
    title?: string;
    visibility?: "visible" | "hidden";
    environment?: "managed-worktree" | "reuse";
    baseBranch?: string;
  }) => {
    if (input.baseBranch && input.environment !== "managed-worktree")
      throw new Error("baseBranch requires environment managed-worktree");
    if (input.mode === "direct" && (input.environment || input.baseBranch))
      throw new Error("Environment selection is only valid for delegated execution");
    const root = await rootThread(input.rootThreadId);
    const saved = await read();
    const index = saved.executions.findIndex(
      (binding) =>
        binding.rootThreadId === root.id &&
        binding.idempotencyKey === input.idempotencyKey,
    );
    if (index < 0)
      throw new Error(
        "Create or reuse the execution task before binding an owner",
      );
    const current = saved.executions[index];
    const problem = executionBindingDispatchProblem(current);
    if (problem) throw new Error(`Dispatch recovery is required: ${problem}`);
    if (current.ownerThreadId) {
      if (current.mode !== input.mode)
        throw new Error(
          `Execution task is already bound in ${current.mode} mode`,
        );
      return {
        binding: current,
        spawnedThreadId:
          current.mode === "delegated" ? current.ownerThreadId : null,
      };
    }
    const save = async (binding: ExecutionBinding) => {
      const executions = [...saved.executions];
      executions[index] = binding;
      await write({ outcomes: saved.outcomes, executions });
      return binding;
    };
    if (input.mode === "direct") {
      const pending = await save(
        bindExecutionOwner(
          current,
          "direct",
          root.id,
          "pending_attachment",
          null,
        ),
      );
      try {
        await tasks.call(
          "taskThreadsAttach",
          { taskId: pending.executionTaskId, threadId: root.id },
          z.object({ threadId: z.string() }),
        );
      } catch (error) {
        const message = `Root thread ${root.id} could not be attached to execution task ${pending.executionTaskId}: ${error instanceof Error ? error.message : String(error)}`;
        return {
          binding: await save(
            bindExecutionOwner(
              pending,
              "direct",
              root.id,
              "recovery_required",
              message,
            ),
          ),
          spawnedThreadId: null,
        };
      }
      return finalizeWorkBindingOwner({
        pending,
        mode: "direct",
        ownerThreadId: root.id,
        rootThreadId: root.id,
        spawnedThreadId: null,
        realtime: bb.realtime,
        save,
      });
    }
    if (!input.prompt) throw new Error("Delegated execution requires a prompt");
    const environment = async () => {
      if (input.environment === "reuse") {
        if (!root.environmentId)
          throw new Error("Reuse delegation requires the root thread environment");
        return { type: "reuse" as const, environmentId: root.environmentId };
      }
      if (input.environment === "managed-worktree") {
        if (!root.environmentId)
          throw new Error("Managed-worktree delegation requires the root thread environment");
        const rootEnvironment = await bb.sdk.environments.get({
          environmentId: root.environmentId,
        });
        return {
          type: "host" as const,
          hostId: rootEnvironment.hostId,
          workspace: {
            type: "managed-worktree" as const,
            baseBranch: input.baseBranch
              ? { kind: "named" as const, name: input.baseBranch }
              : { kind: "default" as const },
          },
        };
      }
      return root.environmentId
        ? { type: "reuse" as const, environmentId: root.environmentId }
        : { type: "project-default" as const };
    };
    const selectedEnvironment = await environment();
    const pendingSpawn = await save(
      bindExecutionOwner(current, "delegated", null, "pending_spawn", null),
    );
    let spawned: Awaited<ReturnType<typeof bb.sdk.threads.spawn>>;
    try {
      spawned = await bb.sdk.threads.spawn({
        projectId: root.projectId,
        parentThreadId: root.id,
        environment: selectedEnvironment,
        prompt: input.prompt,
        title: input.title,
        visibility: input.visibility ?? "visible",
      });
    } catch (error) {
      const message = `Spawn may have completed but did not return: ${error instanceof Error ? error.message : String(error)}`;
      return {
        binding: await save(
          bindExecutionOwner(
            pendingSpawn,
            "delegated",
            null,
            "recovery_required",
            message,
          ),
        ),
        spawnedThreadId: null,
      };
    }
    const pendingAttachment = await save(
      bindExecutionOwner(
        pendingSpawn,
        "delegated",
        spawned.id,
        "pending_attachment",
        null,
      ),
    );
    try {
      await tasks.call(
        "taskThreadsAttach",
        { taskId: pendingAttachment.executionTaskId, threadId: spawned.id },
        z.object({ threadId: z.string() }),
      );
    } catch (error) {
      const message = `Child thread ${spawned.id} was created but attachment did not complete: ${error instanceof Error ? error.message : String(error)}`;
      return {
        binding: await save(
          bindExecutionOwner(
            pendingAttachment,
            "delegated",
            spawned.id,
            "recovery_required",
            message,
          ),
        ),
        spawnedThreadId: spawned.id,
      };
    }
    return finalizeWorkBindingOwner({
      pending: pendingAttachment,
      mode: "delegated",
      ownerThreadId: spawned.id,
      rootThreadId: root.id,
      spawnedThreadId: spawned.id,
      realtime: bb.realtime,
      save,
    });
  };
  return {
    read,
    write,
    pruneTerminalExecution,
    rootThread,
    descendants,
    summarize,
    links,
    legacy,
    context,
    invalidateLegacy,
    outcome,
    execution,
    owner,
  };
}

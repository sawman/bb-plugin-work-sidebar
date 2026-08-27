export type DispatchState =
  | "ready"
  | "pending_spawn"
  | "pending_attachment"
  | "recovery_required";
export type BindingMode = "direct" | "delegated";

export interface OutcomeBinding {
  kind: "outcome";
  rootThreadId: string;
  outcomeTaskId: string;
  taskProjectId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionBinding {
  kind: "execution";
  rootThreadId: string;
  outcomeTaskId: string;
  taskProjectId: string;
  executionTaskId: string;
  ownerThreadId: string | null;
  mode: BindingMode | null;
  idempotencyKey: string;
  dispatchState: DispatchState;
  recoveryMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkBindings {
  outcomes: OutcomeBinding[];
  executions: ExecutionBinding[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function emptyBindings(): WorkBindings {
  return { outcomes: [], executions: [] };
}

function isDispatchState(value: unknown): value is DispatchState {
  return (
    value === "ready" ||
    value === "pending_spawn" ||
    value === "pending_attachment" ||
    value === "recovery_required"
  );
}

/** Sanitizes only plugin-owned durable state; Tasks attachments never imply ownership. */
export function normalizeBindings(value: unknown): WorkBindings {
  if (
    !isRecord(value) ||
    !Array.isArray(value.outcomes) ||
    !Array.isArray(value.executions)
  )
    return emptyBindings();
  const outcomes = value.outcomes.flatMap((row): OutcomeBinding[] =>
    isRecord(row) &&
    row.kind === "outcome" &&
    typeof row.rootThreadId === "string" &&
    typeof row.outcomeTaskId === "string" &&
    typeof row.taskProjectId === "string" &&
    typeof row.createdAt === "string" &&
    typeof row.updatedAt === "string"
      ? [
          {
            kind: "outcome",
            rootThreadId: row.rootThreadId,
            outcomeTaskId: row.outcomeTaskId,
            taskProjectId: row.taskProjectId,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          },
        ]
      : [],
  );
  const executions = value.executions.flatMap((row): ExecutionBinding[] =>
    isRecord(row) &&
    row.kind === "execution" &&
    typeof row.rootThreadId === "string" &&
    typeof row.outcomeTaskId === "string" &&
    typeof row.taskProjectId === "string" &&
    typeof row.executionTaskId === "string" &&
    typeof row.idempotencyKey === "string" &&
    (row.ownerThreadId === null || typeof row.ownerThreadId === "string") &&
    (row.mode === null || row.mode === "direct" || row.mode === "delegated") &&
    isDispatchState(row.dispatchState) &&
    (row.recoveryMessage === null || typeof row.recoveryMessage === "string") &&
    typeof row.createdAt === "string" &&
    typeof row.updatedAt === "string"
      ? [
          {
            kind: "execution",
            rootThreadId: row.rootThreadId,
            outcomeTaskId: row.outcomeTaskId,
            taskProjectId: row.taskProjectId,
            executionTaskId: row.executionTaskId,
            ownerThreadId: row.ownerThreadId,
            mode: row.mode,
            idempotencyKey: row.idempotencyKey,
            dispatchState: row.dispatchState,
            recoveryMessage: row.recoveryMessage,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
          },
        ]
      : [],
  );
  return { outcomes, executions };
}

/** Reuses only a stable execution key in plugin-owned state, never an attachment. */
export function upsertExecutionBinding(
  bindings: WorkBindings,
  binding: ExecutionBinding,
): { bindings: WorkBindings; reused: boolean } {
  const index = bindings.executions.findIndex(
    (item) =>
      item.rootThreadId === binding.rootThreadId &&
      item.idempotencyKey === binding.idempotencyKey,
  );
  if (index >= 0) return { bindings, reused: true };
  return {
    bindings: {
      outcomes: [...bindings.outcomes],
      executions: [...bindings.executions, binding],
    },
    reused: false,
  };
}

export function bindExecutionOwner(
  binding: ExecutionBinding,
  mode: BindingMode,
  ownerThreadId: string | null,
  dispatchState: DispatchState,
  recoveryMessage: string | null,
): ExecutionBinding {
  return {
    ...binding,
    mode,
    ownerThreadId,
    dispatchState,
    recoveryMessage,
    updatedAt: new Date().toISOString(),
  };
}

export function executionBindingDispatchProblem(
  binding: ExecutionBinding,
): string | null {
  if (binding.dispatchState === "recovery_required")
    return binding.recoveryMessage ?? "the prior dispatch outcome is uncertain";
  if (binding.dispatchState === "pending_spawn")
    return "the prior delegated spawn is still pending or was interrupted before a child thread id was durably confirmed";
  if (binding.dispatchState === "pending_attachment")
    return `the prior thread dispatch is pending task attachment${binding.ownerThreadId ? ` for ${binding.ownerThreadId}` : ""}`;
  if (binding.mode && !binding.ownerThreadId)
    return `the ${binding.mode} execution binding has no durable owner thread`;
  return null;
}

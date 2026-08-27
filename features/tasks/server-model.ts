import type { ExecutionBinding, OutcomeBinding } from "../work-context/server-bindings.js";

export type TaskRecord = {
  id: string;
  projectId: string;
  key: string;
  title: string;
  status: "backlog" | "todo" | "in_progress" | "in_review" | "done" | "canceled";
  priority: "urgent" | "high" | "medium" | "low" | "none";
  dueDate: string | null;
  parentTaskId: string | null;
  position: number;
};

export function projectSidebarTask(task: TaskRecord, projectName: string, linkedThreadIds: readonly string[], assignee: "agent" | "human" = "human") {
  return {
    id: task.id, projectId: task.projectId, projectName, key: task.key, title: task.title,
    status: task.status, priority: task.priority, dueDate: task.dueDate, parentTaskId: task.parentTaskId,
    position: task.position, linkedThreadIds: [...linkedThreadIds], assignee,
  };
}

export function summarizeTask(task: TaskRecord, projectName = "Work") {
  return {
    id: task.id, projectId: task.projectId, projectName, key: task.key, title: task.title, status: task.status,
    priority: task.priority, dueDate: task.dueDate, parentTaskId: task.parentTaskId,
  };
}

export function projectPrefix(name: string, projectId: string, usedPrefixes: ReadonlySet<string>): string {
  const letters = name.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const base = /^[A-Z]/.test(letters) ? letters.slice(0, 10) : "WORK";
  if (!usedPrefixes.has(base)) return base;
  const suffix = projectId.replace(/[^a-zA-Z0-9]/g, "").slice(-3).toUpperCase();
  return `${base.slice(0, 7) || "WORK"}${suffix}`.slice(0, 10);
}

export function assertThreadEnvironmentProject(threadProjectId: string, environmentProjectId: string, allowedProjectIds: readonly string[] = []) {
  const valid = new Set([threadProjectId, ...allowedProjectIds]);
  if (!valid.has(environmentProjectId)) throw new Error(`Environment project mismatch: environment ${environmentProjectId} does not match thread ${threadProjectId}`);
}

/** Strict precedence for a Tasks project; null means exactly one linked project must be created. */
export function resolveProjectSelection(projects: readonly { id: string; linkedBbProjectId: string | null }[], threadProjectId: string, options: { explicitTaskProjectId?: string | null; parentTaskProjectId?: string | null; bindingTaskProjectId?: string | null }, validLinkedBbProjectIds: readonly string[] = []): string | null {
  const valid = new Set([threadProjectId, ...validLinkedBbProjectIds]);
  const validate = (taskProjectId: string, source: string) => {
    const project = projects.find((candidate) => candidate.id === taskProjectId);
    if (!project) throw new Error(`${source} Tasks project was not found: ${taskProjectId}`);
    if (!project.linkedBbProjectId) throw new Error(`${source} Tasks project must be linked to a BB project`);
    if (!valid.has(project.linkedBbProjectId)) throw new Error(`${source} Tasks project must be linked to thread project ${threadProjectId}`);
    return project.id;
  };
  if (options.explicitTaskProjectId) return validate(options.explicitTaskProjectId, "Explicit");
  if (options.parentTaskProjectId) return validate(options.parentTaskProjectId, "Outcome");
  if (options.bindingTaskProjectId) return validate(options.bindingTaskProjectId, "Binding");
  const linked = projects.filter((project) => project.linkedBbProjectId === threadProjectId);
  if (linked.length > 1) throw new Error(`Ambiguous Tasks project mapping for BB project ${threadProjectId}; found ${linked.length} linked projects`);
  return linked[0]?.id ?? null;
}

export function assertOutcomeTaskBinding(binding: OutcomeBinding, task: TaskRecord) {
  if (task.parentTaskId !== null) throw new Error("Outcome binding is not a top-level Tasks task; nesting execution work is not supported");
  if (task.projectId !== binding.taskProjectId) throw new Error(`Outcome binding project mismatch: task ${task.id} is in ${task.projectId}, binding expects ${binding.taskProjectId}`);
}

export function assertExecutionTaskBinding(binding: ExecutionBinding, task: TaskRecord) {
  if (task.parentTaskId !== binding.outcomeTaskId) throw new Error("Execution binding is no longer a direct child of the durable outcome");
  if (task.projectId !== binding.taskProjectId) throw new Error(`Execution binding project mismatch: task ${task.id} is in ${task.projectId}, binding expects ${binding.taskProjectId}`);
}

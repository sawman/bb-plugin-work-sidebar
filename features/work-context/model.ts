import type { QueryPolicy } from "../../query-runtime";
import type { TaskStatus } from "../tasks/model";

export type WorkContextCard = "status" | "activity" | "outcome" | "goal" | "plan";

const root = ["work-sidebar", "work-context"] as const;

export const workContextCardKeys = {
  status: (threadId: string) => [...root, "status", threadId] as const,
  activity: (threadId: string) => [...root, "activity", threadId] as const,
  outcome: (threadId: string) => [...root, "outcome", threadId] as const,
  goal: (threadId: string) => [...root, "goal", threadId] as const,
  plan: (threadId: string) => [...root, "plan", threadId] as const,
};

/** Context cards retain a thread snapshot while refetching after a switch. */
export const workContextCardPolicy: QueryPolicy = {
  staleTime: 5_000,
  gcTime: 10 * 60_000,
  retry: 1,
  refetchOnWindowFocus: false,
};

/** Latest activity is short-lived and polls only while its selected thread runs. */
export const workActivityPolicy: QueryPolicy = {
  staleTime: 0,
  gcTime: 2 * 60_000,
  retry: 1,
  refetchOnWindowFocus: false,
  refetchOnReconnect: true,
};

export function shouldPollWorkActivity(status: string | undefined): boolean {
  return status === "active" || status === "starting";
}

export function nextOutcomeStatus(status: TaskStatus): TaskStatus | null {
  return ({ backlog: "todo", todo: "in_progress", in_progress: "in_review", in_review: "done" } as Partial<Record<TaskStatus, TaskStatus>>)[status] ?? null;
}

export type WorkSidebarRealtimeFamily =
  "work" | "changes" | "tracker" | "tasks";

type RootScopedWorkEvent = Readonly<{
  family: "work";
  rootThreadId: string;
}>;
type ThreadScopedRealtimeEvent = Readonly<{
  family: Exclude<WorkSidebarRealtimeFamily, "work">;
  threadId: string;
}>;
export type WorkSidebarRealtimeEvent =
  | RootScopedWorkEvent
  | ThreadScopedRealtimeEvent;

const families = new Set<WorkSidebarRealtimeFamily>([
  "work",
  "changes",
  "tracker",
  "tasks",
]);

/** Reject legacy, unscoped, and malformed broadcast payloads at the boundary. */
export function parseWorkSidebarRealtimeEvent(
  value: unknown,
): WorkSidebarRealtimeEvent | null {
  if (!value || typeof value !== "object") return null;
  const event = value as Record<string, unknown>;
  if (typeof event.family !== "string" || !families.has(event.family as WorkSidebarRealtimeFamily))
    return null;
  if (event.family === "work")
    return typeof event.rootThreadId === "string" && event.rootThreadId.startsWith("thr_")
      ? { family: "work", rootThreadId: event.rootThreadId }
      : null;
  return typeof event.threadId === "string" && event.threadId.startsWith("thr_")
    ? {
      family: event.family as Exclude<WorkSidebarRealtimeFamily, "work">,
      threadId: event.threadId,
    }
    : null;
}

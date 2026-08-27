export type WorkSidebarRealtimeFamily =
  "work" | "changes" | "tracker" | "tasks";

export type WorkSidebarRealtimeEvent = Readonly<{
  family: WorkSidebarRealtimeFamily;
  threadId: string;
}>;

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
  if (
    typeof event.threadId !== "string" ||
    !event.threadId.startsWith("thr_") ||
    typeof event.family !== "string" ||
    !families.has(event.family as WorkSidebarRealtimeFamily)
  )
    return null;
  return {
    family: event.family as WorkSidebarRealtimeFamily,
    threadId: event.threadId,
  };
}

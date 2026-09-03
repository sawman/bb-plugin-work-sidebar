export const GROUP_ACTIVITY_STATES = [
  "error",
  "attention",
  "completed",
  "working",
] as const;

export type ThreadGroupActivity = (typeof GROUP_ACTIVITY_STATES)[number];
export type GroupActivityPriority = ThreadGroupActivity[];

export const DEFAULT_GROUP_ACTIVITY_PRIORITY: GroupActivityPriority = [
  "error",
  "attention",
  "completed",
  "working",
];

export function normalizeGroupActivityPriority(
  value: unknown,
): GroupActivityPriority {
  if (
    !Array.isArray(value) ||
    value.length !== GROUP_ACTIVITY_STATES.length ||
    value.some((item) => !GROUP_ACTIVITY_STATES.includes(item as never)) ||
    new Set(value).size !== GROUP_ACTIVITY_STATES.length
  ) {
    return DEFAULT_GROUP_ACTIVITY_PRIORITY;
  }
  return value as ThreadGroupActivity[];
}

export function prioritizeGroupActivity(
  current: ThreadGroupActivity | null,
  candidate: ThreadGroupActivity | null,
  priority: GroupActivityPriority = DEFAULT_GROUP_ACTIVITY_PRIORITY,
): ThreadGroupActivity | null {
  if (!candidate) return current;
  if (!current) return candidate;
  return priority.indexOf(candidate) < priority.indexOf(current)
    ? candidate
    : current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function projectLatestActivity(rows: readonly unknown[], latestAssistant: string | null, hasCurrentTurn: boolean) {
  const flattened: unknown[] = [];
  const visit = (items: readonly unknown[]) => items.forEach((item) => {
    flattened.push(item);
    if (isRecord(item) && Array.isArray(item.children)) visit(item.children);
  });
  visit(rows);
  type ActivityKind = "assistant" | "user" | "command" | "activity";
  type Activity = { text: string; kind: ActivityKind };
  const activity: Activity[] = [];
  for (const row of flattened) {
    if (!isRecord(row)) continue;
    if (row.kind === "conversation" && typeof row.text === "string" && row.text.trim()) activity.push({ text: row.text.trim(), kind: row.role === "assistant" ? "assistant" : "user" });
    else if (row.kind === "work" && row.workKind === "command" && typeof row.command === "string" && row.command.trim()) activity.push({ text: row.command.trim(), kind: "command" });
    else if (typeof row.text === "string" && row.text.trim()) activity.push({ text: row.text.trim(), kind: "activity" });
  }
  const last = (kind: ActivityKind) => [...activity].reverse().find((item) => item.kind === kind);
  const lastUser = last("user");
  const lastAssistant = last("assistant");
  return {
    latest: latestAssistant?.trim() ? { text: latestAssistant.trim().slice(0, 360), kind: "assistant" as const } : lastAssistant ? { text: lastAssistant.text.slice(0, 360), kind: "assistant" as const } : null,
    lastUser: lastUser ? { text: lastUser.text.slice(0, 360), kind: "user" as const } : null,
    current: hasCurrentTurn && lastUser ? { text: lastUser.text.slice(0, 360), kind: "user" as const } : null,
  };
}

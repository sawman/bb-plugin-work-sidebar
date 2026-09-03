function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function formatActivityAge(createdAt: number, now = Date.now()) {
  const elapsedMinutes = Math.max(0, Math.floor((now - createdAt) / 60_000));
  if (elapsedMinutes < 1) return "now";
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;
  return `${Math.floor(elapsedHours / 24)}d ago`;
}

export function projectLatestActivity(
  rows: readonly unknown[],
  latestAssistant: string | null,
  hasCurrentTurn: boolean,
) {
  const flattened: unknown[] = [];
  const visit = (items: readonly unknown[]) =>
    items.forEach((item) => {
      flattened.push(item);
      if (isRecord(item) && Array.isArray(item.children)) visit(item.children);
    });
  visit(rows);
  type ActivityKind = "assistant" | "user" | "command" | "activity";
  type Activity = { text: string; kind: ActivityKind; createdAt: number | null };
  const activity: Activity[] = [];
  for (const row of flattened) {
    if (!isRecord(row)) continue;
    const createdAt = typeof row.createdAt === "number" ? row.createdAt : null;
    if (
      row.kind === "conversation" &&
      typeof row.text === "string" &&
      row.text.trim()
    ) {
      activity.push({
        text: row.text.trim(),
        kind: row.role === "assistant" ? "assistant" : "user",
        createdAt,
      });
    } else if (
      row.kind === "work" &&
      row.workKind === "command" &&
      typeof row.command === "string" &&
      row.command.trim()
    ) {
      activity.push({ text: row.command.trim(), kind: "command", createdAt });
    } else if (typeof row.text === "string" && row.text.trim()) {
      activity.push({ text: row.text.trim(), kind: "activity", createdAt });
    }
  }
  const last = (kind: ActivityKind) =>
    [...activity].reverse().find((item) => item.kind === kind);
  const lastUser = last("user");
  const lastAssistant = last("assistant");
  return {
    latest: latestAssistant?.trim()
      ? {
          text: latestAssistant.trim().slice(0, 360),
          kind: "assistant" as const,
          createdAt: lastAssistant?.createdAt ?? null,
        }
      : lastAssistant
        ? {
            text: lastAssistant.text.slice(0, 360),
            kind: "assistant" as const,
            createdAt: lastAssistant.createdAt,
          }
        : null,
    lastUser: lastUser
      ? {
          text: lastUser.text.slice(0, 360),
          kind: "user" as const,
          createdAt: lastUser.createdAt,
        }
      : null,
    current: hasCurrentTurn && lastUser
      ? {
          text: lastUser.text.slice(0, 360),
          kind: "user" as const,
          createdAt: lastUser.createdAt,
        }
      : null,
  };
}

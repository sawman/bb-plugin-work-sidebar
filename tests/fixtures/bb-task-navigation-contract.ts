// Executable contract excerpts from BB desktop-v0.46.1, commit
// 411eac54ac16d0a3cb57d1de8396d37564884a73 (SDK 0.6.49).
// Host: packages/client-core/src/routes/route-paths.ts
// Tasks: plugins/tasks/shell/routes.ts; app.tsx registers plugin tasks/path tasks.
// Keep these excerpts aligned with the installed host at compatibility checkpoints.
import { expect } from "vitest";

interface PluginPanelRoutePathArgs {
  pluginId: string;
  path: string;
  subPath?: string;
}

export function getPluginPanelRoutePath({
  pluginId,
  path,
  subPath,
}: PluginPanelRoutePathArgs): string {
  const root = `/plugins/${encodeURIComponent(pluginId)}/${encodeURIComponent(path)}`;
  if (subPath === undefined || subPath === "") {
    return root;
  }
  const encoded = subPath
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return encoded.length > 0 ? `${root}/${encoded}` : root;
}

export type TaskViewMode = "list" | "board";

export type TasksRoute =
  | { kind: "all" }
  | { kind: "active" }
  | { kind: "manage" }
  | { kind: "project"; projectId: string; view: TaskViewMode | null }
  | { kind: "task"; taskKey: string };

export type ResolvedTasksRoute =
  | Exclude<TasksRoute, { kind: "project" }>
  | { kind: "project"; projectId: string; view: TaskViewMode };

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function parseTasksRoute(rawSubPath: string): TasksRoute {
  const subPath = rawSubPath.split("/").map(decodeSegment).join("/");
  const queryIndex = subPath.indexOf("?");
  const path = queryIndex === -1 ? subPath : subPath.slice(0, queryIndex);
  const query = queryIndex === -1 ? "" : subPath.slice(queryIndex + 1);
  const segments = path.split("/").filter((segment) => segment.length > 0);
  const head = segments[0];
  if (head === undefined || head === "all") return { kind: "all" };
  if (head === "active") return { kind: "active" };
  if (head === "manage") return { kind: "manage" };
  if (head === "task") {
    const taskKey = segments[1];
    if (taskKey !== undefined) return { kind: "task", taskKey };
    return { kind: "all" };
  }
  const view = new URLSearchParams(query).get("view");
  return {
    kind: "project",
    projectId: head,
    view: view === "board" || view === "list" ? view : null,
  };
}

export function expectTaskDetailLink(element: HTMLElement, taskKey: string) {
  const href = element.getAttribute("href");
  // Use the host builder, then resolve the registered panel and its real handler.
  expect(href).toBe(getPluginPanelRoutePath({
    pluginId: "tasks", path: "tasks", subPath: `task/${taskKey}`,
  }));
  const segments = new URL(href!, "https://bb.local").pathname.split("/");
  expect(segments.slice(1, 4)).toEqual(["plugins", "tasks", "tasks"]);
  expect(parseTasksRoute(segments.slice(4).join("/"))).toEqual({ kind: "task", taskKey });
}

import type { ComponentProps } from "react";
import { UrlLink } from "@get-bb/plugin-sdk/app";

/** BB 0.46 Tasks navPanel: plugin `tasks`, path `tasks`, detail keyed by task key.
 * toPluginPanel is caller-scoped, so cross-plugin links use the host UrlLink.
 */
export function taskDetailHref(taskKey: string) {
  return `/plugins/tasks/tasks/task/${encodeURIComponent(taskKey)}`;
}

export function TaskLink({
  taskKey,
  ...props
}: Omit<ComponentProps<typeof UrlLink>, "href"> & { taskKey: string }) {
  return <UrlLink {...props} href={taskDetailHref(taskKey)} />;
}

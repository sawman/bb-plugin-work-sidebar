import { useCallback } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";

/** The built-in Tasks plugin's stable detail route. */
export function taskPanelPath(taskKey: string) {
  return `task/${encodeURIComponent(taskKey)}`;
}

/** Opens a BB Task through the host-owned Tasks plugin. */
export function useOpenTask() {
  const navigate = useBbNavigate();
  return useCallback(
    (taskKey: string) => {
      navigate.toPluginPanel("tasks", { subPath: taskPanelPath(taskKey) });
    },
    [navigate],
  );
}

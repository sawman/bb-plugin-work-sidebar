import { describe, expect, it } from "vitest";
import { taskDetailHref } from "../task-navigation";
import {
  getPluginPanelRoutePath,
  parseTasksRoute,
} from "../../../tests/fixtures/bb-task-navigation-contract";

describe("BB 0.46 task navigation contract", () => {
  it("reproduces the caller-scoped wrong panel behind the error page", () => {
    // useBbNavigate closes over the caller pluginId, not the target panel owner.
    const oldTarget = getPluginPanelRoutePath({
      pluginId: "work-sidebar", path: "tasks", subPath: "task/BBPLUG-428",
    });
    expect(oldTarget).toBe("/plugins/work-sidebar/tasks/task/BBPLUG-428");
    expect(taskDetailHref("BBPLUG-428")).not.toBe(oldTarget);
  });

  it.each(["BBPLUG-428", "WORK-9", "OPS-12345"])(
    "resolves %s to the registered Tasks panel and task-key handler",
    (taskKey) => {
      const target = taskDetailHref(taskKey);
      expect(target).toBe(getPluginPanelRoutePath({
        pluginId: "tasks", path: "tasks", subPath: `task/${taskKey}`,
      }));
      const [, root, pluginId, panelPath, ...remainder] = target.split("/");
      expect({ root, pluginId, panelPath }).toEqual({
        root: "plugins", pluginId: "tasks", panelPath: "tasks",
      });
      expect(parseTasksRoute(remainder.join("/"))).toEqual({ kind: "task", taskKey });
    },
  );
});

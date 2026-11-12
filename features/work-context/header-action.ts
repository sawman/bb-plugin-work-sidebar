import type { PluginThreadActionRegistration } from "@get-bb/plugin-sdk/app";

/** BB owns header rendering, compact placement and the focused panel. */
export const workHeaderAction: PluginThreadActionRegistration = {
  id: "work-context-header",
  title: "Work",
  icon: "ListTodo",
  group: "work-sidebar",
  placement: "header",
  item: ({ experimental_panel }) => ({
    label: "Work",
    icon: "ListTodo",
    run: () => {
      experimental_panel.openTab({
        tab: { context: { kind: "thread" }, availability: "action", id: "work-context" },
      });
    },
  }),
};

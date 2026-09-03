import {
  definePluginApp,
  useBbNavigate,
  useComposer,
  useComposerView,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type { PluginThreadHeaderActionProps } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "./contracts";
import "./app.css";
import "./scrollbar.css";
import "./views.css";
import { WorkThreadList } from "./features/threads/left-sidebar";
import { SidebarAppearanceSettings } from "./features/threads/sidebar-appearance-settings";
import { WorkPanel } from "./features/work-context/panel";
import { withPluginProviders } from "./query-runtime";
import { ActionTooltip } from "./components/ui/action-tooltip";

function WorkContextHeaderAction({
  isCompactViewport,
}: PluginThreadHeaderActionProps) {
  const navigate = useBbNavigate();
  return (
    <ActionTooltip label="Open Work">
      {(tooltipId) => <button
      type="button"
      className="ws-header-action"
      aria-label="Open Work"
      aria-describedby={tooltipId}
      onClick={() => {
        navigate.openThreadPanel({ actionId: "work-context" });
      }}
    >
      {isCompactViewport ? "▣" : "Work"}
      </button>}
    </ActionTooltip>
  );
}

function OptionalIntegrationsSettings() {
  return (
    <section className="ws-settings-card" data-layout="narrow">
      <strong>Optional integrations</strong>
      <p>
        Install and configure Taskboard to link Linear issues to Work items.
      </p>
      <small>
        Without Taskboard, Linear controls stay hidden while BB Tasks and the
        rest of Work Sidebar continue to work normally.
      </small>
    </section>
  );
}

function TrackWorkAction() {
  const rpc = useRpc<typeof rpcContract>();
  const composer = useComposer();
  const view = useComposerView();
  if (view.scope.kind !== "thread") return null;
  const threadId = view.scope.threadId;
  const track = async () => {
    const title =
      view.draft.text.trim().split("\n")[0]?.slice(0, 100) || "New work";
    try {
      const result = await rpc.call("createWorkTask", {
        threadId,
        title,
        description: view.draft.text,
        parentTaskId: null,
      });
      composer.updateText(
        (current) =>
          `Work through ${result.task.key}: ${result.task.title}.\n\n${current}`,
      );
      toast.success(`${result.task.key} created and attached`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not track work",
      );
    }
  };
  return (
    <ActionTooltip label="Create and attach a BB task before sending">
      {(tooltipId) => <button
      className="ws-track-action"
      aria-label="Track this work as a task"
      aria-describedby={tooltipId}
      onClick={() => void track()}
    >
      Task
      </button>}
    </ActionTooltip>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "sidebar-appearance",
    title: "Sidebar appearance",
    description: "Tune the shared Threads, Tasks, and PR row layout.",
    component: withPluginProviders(SidebarAppearanceSettings),
  });
  app.slots.settingsSection({
    id: "optional-integrations",
    title: "Optional integrations",
    description: "Enhance Work items with external tracker support.",
    component: withPluginProviders(OptionalIntegrationsSettings),
  });
  app.slots.experimental_threadList({
    id: "work-queue",
    title: "Tasks",
    description: "Global outcome and execution task queue.",
    component: withPluginProviders(WorkThreadList),
  });
  app.slots.threadPanelAction({
    id: "work-context",
    title: "Work",
    icon: "ListTodo",
    component: withPluginProviders(WorkPanel),
    layout: "flush",
  });
  app.slots.experimental_threadHeaderAction({
    id: "work-context-header",
    title: "Work",
    component: withPluginProviders(WorkContextHeaderAction),
  });
  app.composer.customize({
    id: "task-first",
    scopes: ["thread"],
    actions: [
      { id: "track-work", component: withPluginProviders(TrackWorkAction) },
    ],
  });
});

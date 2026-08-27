import type { PluginThreadListProps } from "@get-bb/plugin-sdk/app";
import { ThreadsSidebarController } from "./sidebar-controller";

/** Registered left-slot composition entry. */
export function WorkThreadList(props: PluginThreadListProps) {
  return <ThreadsSidebarController {...props} />;
}

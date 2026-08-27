import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { ServerLifecycle } from "../../server-lifecycle.js";
import {
  createTasksService,
  type TasksRegistration,
  WORK_AGENT_INSTRUCTIONS,
} from "./server-service.js";

export { type TasksRegistration, WORK_AGENT_INSTRUCTIONS };

/** RPC/tool composition boundary for the Tasks vertical slice. */
export function createTasksRegistration(
  bb: BbPluginApi,
  lifecycle: ServerLifecycle,
): TasksRegistration {
  return createTasksService(bb, lifecycle);
}

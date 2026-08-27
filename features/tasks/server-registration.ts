import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  createTasksService,
  type TasksRegistration,
  WORK_AGENT_INSTRUCTIONS,
} from "./server-service.js";

export { type TasksRegistration, WORK_AGENT_INSTRUCTIONS };

/** RPC/tool composition boundary for the Tasks vertical slice. */
export function createTasksRegistration(bb: BbPluginApi): TasksRegistration {
  return createTasksService(bb);
}

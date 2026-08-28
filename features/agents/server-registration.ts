import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import { rpcContract } from "../../contracts.js";

type AgentHandlers = Pick<
  PluginRpcHandlers<typeof rpcContract>,
  "getAgentDetails"
>;

/** Model metadata is not part of the browser's host-owned sidebar roster. */
export function createAgentRegistration(bb: BbPluginApi): AgentHandlers {
  return {
    async getAgentDetails({ threadIds }) {
      const agents = await Promise.all(
        threadIds.map(async (threadId) => ({
          threadId,
          model:
            (await bb.sdk.threads.defaultExecutionOptions({ threadId }))
              ?.model ?? null,
        })),
      );
      return { agents };
    },
  };
}

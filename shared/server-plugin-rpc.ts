import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { z } from "zod";

export type PluginRpcInput =
  | string
  | number
  | boolean
  | null
  | PluginRpcInput[]
  | { [key: string]: PluginRpcInput };

/** Schema-validating call boundary shared by Tasks, Tracker, and Changes. */
export function createPluginRpcCaller(bb: BbPluginApi) {
  return async <T>(
    pluginId: string,
    method: string,
    input: PluginRpcInput,
    outputSchema: z.ZodType<T>,
  ): Promise<T> =>
    bb.sdk.plugins.callRpc({ pluginId, method, input, outputSchema });
}

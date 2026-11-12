import { defineRpcContract } from "@get-bb/plugin-sdk";
import { rpcSchemas } from "./contracts.schemas.js";

// Server-only composition: app code may import this module's type, but its
// runtime contract comes exclusively from the browser-safe Zod schemas.
type RpcInputs = { [Method in keyof typeof rpcSchemas]: typeof rpcSchemas[Method]["input"] };
type RpcOutputs = { [Method in keyof typeof rpcSchemas]: typeof rpcSchemas[Method]["output"] };
// SDK 0.6.132 derives tag callbacks through a mapped type. Supplying the exact
// schema maps avoids expanding the whole graph during generic inference.
export const rpcContract = defineRpcContract<RpcInputs, RpcOutputs>(rpcSchemas);

export type { GitHubStackBranch, GitHubStackSignal } from "./contracts.schemas.js";

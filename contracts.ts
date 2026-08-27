import { defineRpcContract } from "@get-bb/plugin-sdk";
import { rpcSchemas } from "./contracts.schemas.js";

// Server-only composition: app code may import this module's type, but its
// runtime contract comes exclusively from the browser-safe Zod schemas.
export const rpcContract = defineRpcContract(rpcSchemas);

export type { GitHubStackBranch, GitHubStackSignal } from "./contracts.schemas.js";

import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../contracts";
import { useThreadPullRequestDirectory } from "./queries";

/** The enhanced sidebar is the sole owner of its roster-wide PR fact read. */
export function useSidebarThreadPullRequestDirectory(
  threadIds: readonly string[],
  enabled: boolean,
) {
  const rpc = useRpc<typeof rpcContract>();
  return useThreadPullRequestDirectory(rpc, threadIds, enabled);
}

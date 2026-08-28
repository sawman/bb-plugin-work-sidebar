import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../contracts";
import { useSidebarPullRequestStacks } from "../pull-requests/queries";
import { StackNumberBadge } from "../pull-requests/stack-number";

export function ThreadRowStackNumber({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const query = useSidebarPullRequestStacks(rpc, [threadId], true);
  const number = query.data?.[threadId]?.number;
  return number == null ? null : <StackNumberBadge number={number} compact />;
}

import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { PluginRpcClient } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../contracts";
import { changesKeys, changesPolicies } from "./model";

type ChangesRpc = PluginRpcClient<typeof rpcContract>;
export type ChangesPolling = {
  visiblePollMs: number;
  backgroundPollMs: number;
};
function useDocumentVisibility() {
  const [visible, setVisible] = useState(
    () =>
      typeof document === "undefined" || document.visibilityState === "visible",
  );
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}
export function useChanges(
  rpc: ChangesRpc,
  threadId: string,
  polling: ChangesPolling,
) {
  const client = useQueryClient();
  const visible = useDocumentVisibility();
  const projection = useQuery({
    queryKey: changesKeys.projection(threadId),
    queryFn: () => rpc.call("getChanges", { threadId }),
    ...changesPolicies.projection,
  });
  const url = projection.data?.currentPullRequest?.url;
  const previous = useRef<{ identity: string; fingerprint: string | null }>({
    identity: "",
    fingerprint: null,
  });
  const fingerprint = useQuery({
    queryKey: changesKeys.fingerprint(threadId, url ?? "none"),
    queryFn: async () => {
      const result = await rpc.call("getChangesFingerprint", {
        threadId,
        url: url!,
      });
      const identity = `${threadId}:${url}`;
      if (
        previous.current.identity === identity &&
        result.fingerprint &&
        previous.current.fingerprint &&
        result.fingerprint !== previous.current.fingerprint
      )
        void client.invalidateQueries({
          queryKey: changesKeys.projection(threadId),
        });
      previous.current = { identity, fingerprint: result.fingerprint };
      return result;
    },
    enabled: Boolean(url),
    ...changesPolicies.fingerprint,
    refetchInterval: visible ? polling.visiblePollMs : polling.backgroundPollMs,
  });
  return projection;
}
export function invalidateChanges(
  client: {
    invalidateQueries(filters: {
      queryKey: readonly unknown[];
    }): Promise<unknown> | unknown;
  },
  threadId: string,
) {
  return client.invalidateQueries({
    queryKey: changesKeys.projection(threadId),
  });
}

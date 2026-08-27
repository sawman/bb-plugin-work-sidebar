// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { normalizeThreadGroups } from "../model";
import { threadQueryKeys, threadQueryPolicies, saveThreadGroups } from "../queries";

describe("R9 Threads query ownership", () => {
  it("keeps preferences/groups/order in typed Query and normalizes groups without importing server.ts", async () => {
    expect(normalizeThreadGroups({ groups: [{ id: "group_later", name: "Later", threadIds: ["thr_1", "thr_1"] }] })).toEqual([
      { id: "group_later", name: "Later", threadIds: ["thr_1"] },
    ]);
    expect(threadQueryKeys.groups()).toEqual(["work-sidebar", "sidebar", "threads", "groups"]);
    expect(threadQueryPolicies.groups).toMatchObject({ staleTime: Infinity, retry: false });
    const client = new QueryClient();
    const rpc = { call: async (method: string, input: unknown) => ({ groups: input && method === "saveThreadGroups" ? (input as { groups: unknown[] }).groups : [] }) };
    await saveThreadGroups(client, rpc, [{ id: "group_later", name: "Later", threadIds: ["thr_1"] }]);
    expect(client.getQueryData(threadQueryKeys.groups())).toEqual([{ id: "group_later", name: "Later", threadIds: ["thr_1"] }]);
  });
});

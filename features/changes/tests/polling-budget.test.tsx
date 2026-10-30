// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import { createServerLifecycle } from "../../../server-lifecycle";
import { readGitHub } from "../../../shared/github/read-cache";
import { classifyPullRequestError } from "../../pull-requests/health";
import { createPullRequestRegistration } from "../../pull-requests/server-registration";
import type { GitHubReadRunner } from "../../pull-requests/server-types";
import { withNativeStatusRpc } from "../../../tests/fixtures/native-status-rpc";
import { currentPr } from "./latency-fixtures";
import { useChanges } from "../queries";

describe("Changes configured polling at the command boundary", () => {
  it.each([0, 900_000])("background interval %i preserves explicit refresh, visible polling and native RPC authority", async (backgroundPollMs) => {
    vi.useFakeTimers(); vi.setSystemTime(100_000);
    const previousVisibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
    const visibility = (value: string) => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value });
      act(() => document.dispatchEvent(new Event("visibilitychange")));
    };
    visibility("visible");
    const host = createFakePluginHost();
    const lifecycle = createServerLifecycle();
    const nativeRead = vi.fn(async () => ({ outcome: "available", pullRequest: { ...currentPr(), headRefName: "feature/1", baseRefName: "main" } }));
    const bb = withNativeStatusRpc({ ...host.bb, sdk: { ...host.bb.sdk,
      threads: { get: async () => ({ environmentId: "env" }) }, nativeStatus: { read: nativeRead },
      plugins: { callRpc: async () => ({ stack: null, pending: null, error: null }) },
    } });
    const command = vi.fn(async (args: readonly string[]) => {
      if (args[1] === "graphql") return JSON.stringify({ data: { repository: { p0: {
        title: "PR 1", url: currentPr().url, state: "OPEN", isDraft: false, updatedAt: "2026-10-30T00:00:00Z",
        headRefName: "feature/1", baseRefName: "main", headRefOid: "head", baseRefOid: "base",
        reviews: { totalCount: 0, nodes: [] }, reviewRequests: { totalCount: 0, nodes: [] }, reviewDecision: "APPROVED",
        reviewThreads: { totalCount: 0, nodes: [] }, commits: { nodes: [] },
      } } } });
      const target = args.find((arg) => arg.startsWith("repos/"))!;
      if (target.includes("/stacks") || target.includes("/files")) return "[]";
      return JSON.stringify({ updated_at: "stable", state: "open", merged: false, draft: false, head: { ref: "feature/1", sha: "head" }, base: { ref: "main", sha: "base" }, mergeable_state: "clean" });
    });
    const read: GitHubReadRunner = (args, buffer, ttl = 120_000, identity, policy) =>
      readGitHub(lifecycle, command, classifyPullRequestError, args, buffer, ttl, identity, policy);
    const service = createPullRequestRegistration(bb as never, lifecycle, { read, execute: vi.fn() });
    const localReads = vi.fn(async () => ({}));
    const call = vi.fn(async (method: string, input: any) => {
      if (method === "getChangesRepository") return localReads();
      if (method === "getChangesPullRequests") return service.summary(input.threadId, input.validationRequirements);
      if (method === "getChangesProjection") return service.projection(input.threadId);
      if (method === "getChangesFingerprint") return service.fingerprint(input.threadId, input.url);
      if (method === "getChangesRemoteFiles") return service.remoteFiles(input);
      if (method === "invalidateChangesRemote") return service.invalidateRemote(input.repository, input.threadIds);
      throw new Error(`Unexpected test method ${method}`);
    });
    const client = new QueryClient();
    const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const view = renderHook(() => useChanges({ call } as never, "thr", { visiblePollMs: 300_000, backgroundPollMs }), { wrapper });
    const advance = async (duration: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(duration); }); };
    try {
      await advance(10);
      expect(view.result.current.error).toBeNull();
      expect(view.result.current.data?.currentPullRequest?.url).toBe(currentPr().url);
      const initial = command.mock.calls.length;
      expect(initial).toBeGreaterThan(0);
      const initialNative = nativeRead.mock.calls.length;
      visibility("hidden");
      await advance(3_600_000);
      if (backgroundPollMs === 0) {
        expect(command).toHaveBeenCalledTimes(initial);
        expect(nativeRead).toHaveBeenCalledTimes(initialNative);
        expect(localReads).toHaveBeenCalledOnce();
      } else {
        expect(command.mock.calls.length).toBeGreaterThan(initial);
        expect(nativeRead.mock.calls.length).toBeGreaterThan(initialNative);
        expect(localReads).toHaveBeenCalledTimes(5);
      }
      const beforeManual = command.mock.calls.length;
      await act(async () => { await view.result.current.refresh(); });
      await advance(10);
      expect(command.mock.calls.length).toBeGreaterThan(beforeManual);
      const beforeVisible = command.mock.calls.length;
      visibility("visible");
      await advance(300_010);
      expect(command.mock.calls.length).toBeGreaterThan(beforeVisible);
      const beforeDirectNative = nativeRead.mock.calls.length;
      await service.summary("thr");
      expect(nativeRead).toHaveBeenCalledTimes(beforeDirectNative + 1);
      view.unmount();
      const afterUnmount = command.mock.calls.length;
      await advance(900_000);
      expect(command).toHaveBeenCalledTimes(afterUnmount);
    } finally {
      view.unmount(); client.clear(); lifecycle.dispose(); await host.harness.lifecycle.dispose(); vi.useRealTimers();
      if (previousVisibility) Object.defineProperty(document, "visibilityState", previousVisibility);
      else delete (document as { visibilityState?: string }).visibilityState;
    }
  });
});

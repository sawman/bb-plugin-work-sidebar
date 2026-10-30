// @vitest-environment jsdom
import { act, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServerLifecycle } from "../../../server-lifecycle";
import { readGitHub } from "../../../shared/github/read-cache";
import { classifyPullRequestError } from "../health";
import { createAuthoredPullRequestService } from "../server-authored";
import { createRepositoryTopologyReader } from "../remote-topology-server";
import { PullRequestsLeftSidebar } from "../left-sidebar";
import { pullRequestKeys } from "../queries";
import type { GitHubReadRunner } from "../server-types";

afterEach(() => vi.useRealTimers());

describe("authored tab visibility at the command admission boundary", () => {
  it("does not start a cold authored read when its active tab mounts in a hidden document", async () => {
    vi.useFakeTimers(); vi.setSystemTime(100_000);
    const previousVisibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    const host = createFakePluginHost();
    const lifecycle = createServerLifecycle();
    const command = vi.fn(async (_args: readonly string[]) => "[]");
    const read: GitHubReadRunner = (args, buffer, ttl = 120_000, identity, policy) =>
      readGitHub(lifecycle, command, classifyPullRequestError, args, buffer, ttl, identity, policy);
    const handlers = createAuthoredPullRequestService(host.bb, lifecycle, { read, execute: vi.fn() });
    const client = new QueryClient();
    function Sidebar() {
      return <QueryClientProvider client={client}><PullRequestsLeftSidebar active searchQuery="" threads={[]}
        onOpenThread={vi.fn()} settingsControl={null} /></QueryClientProvider>;
    }
    const view = renderSlot({ component: Sidebar }, {}, { rpc: handlers as never });
    try {
      await act(async () => { await vi.advanceTimersByTimeAsync(600_000); });
      expect(command.mock.calls.filter(([args]) => args[0] === "search")).toHaveLength(0);
    } finally {
      view.unmount(); client.clear(); lifecycle.dispose(); await host.harness.lifecycle.dispose();
      if (previousVisibility) Object.defineProperty(document, "visibilityState", previousVisibility);
      else delete (document as { visibilityState?: string }).visibilityState;
    }
  });

  it("admits no cold or interval reads while inactive, retains warm data and resumes on open", async () => {
    vi.useFakeTimers(); vi.setSystemTime(100_000);
    const previousVisibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
    const visibility = (value: string) => {
      Object.defineProperty(document, "visibilityState", { configurable: true, value });
      act(() => document.dispatchEvent(new Event("visibilitychange")));
    };
    visibility("visible");
    const host = createFakePluginHost();
    const lifecycle = createServerLifecycle();
    const command = vi.fn(async (args: readonly string[]) => {
      if (args[0] === "search") return JSON.stringify([{ number: 1, title: "Visible PR", url: "https://github.com/acme/repo/pull/1",
        repository: { nameWithOwner: "acme/repo" }, isDraft: false }]);
      if (args.join(" ").includes("isArchived")) return JSON.stringify({ data: { r0: { isArchived: false } } });
      if (args[1] === "graphql") return JSON.stringify({ data: { repository: { p0: { title: "Visible PR", url: "https://github.com/acme/repo/pull/1",
        state: "OPEN", isDraft: false, headRefName: "feature", baseRefName: "main", headRefOid: "head", baseRefOid: "base",
        reviewDecision: "APPROVED", reviews: { totalCount: 0, nodes: [] }, reviewRequests: { totalCount: 0, nodes: [] }, commits: { nodes: [] } } } } });
      if (args.includes("rate_limit")) return "{}";
      if (args.some((arg) => arg.includes("/stacks"))) return "[]";
      throw new Error("Unexpected mocked GitHub command");
    });
    const read: GitHubReadRunner = (args, buffer, ttl = 120_000, identity, policy) =>
      readGitHub(lifecycle, command, classifyPullRequestError, args, buffer, ttl, identity, policy);
    const handlers = createAuthoredPullRequestService(host.bb, lifecycle, { read, execute: vi.fn() }, createRepositoryTopologyReader(lifecycle, read));
    const client = new QueryClient();
    function Sidebar({ active }: { active: boolean }) {
      return <QueryClientProvider client={client}><PullRequestsLeftSidebar active={active} searchQuery="" threads={[]}
        onOpenThread={vi.fn()} settingsControl={null} /></QueryClientProvider>;
    }
    const view = renderSlot({ component: Sidebar }, { active: false }, { rpc: handlers as never });
    const reads = () => command.mock.calls.filter(([args]) => !args.includes("rate_limit"));
    const advance = async (duration: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(duration); }); };
    try {
      await advance(600_000);
      expect(reads()).toHaveLength(0);
      view.rerender(<Sidebar active />);
      await advance(10);
      expect(reads()).toHaveLength(4); // search, signals, archive lookup, repository topology
      expect(view.getByText("Visible PR")).toBeTruthy();
      visibility("hidden");
      await advance(600_000);
      expect(reads()).toHaveLength(4);
      visibility("visible");
      await advance(10);
      expect(reads()).toHaveLength(8);
      const warm = client.getQueryData(pullRequestKeys.authored());
      view.rerender(<Sidebar active={false} />);
      await advance(600_000);
      expect(reads()).toHaveLength(8);
      expect(client.getQueryData(pullRequestKeys.authored())).toBe(warm);
      view.rerender(<Sidebar active />);
      expect(view.getByText("Visible PR")).toBeTruthy();
      await advance(10);
      expect(reads()).toHaveLength(12);
      await advance(300_000);
      expect(reads()).toHaveLength(16);
      fireEvent.click(view.getByRole("button", { name: "Refresh pull requests" }));
      await advance(10);
      expect(reads()).toHaveLength(20);
      view.unmount();
      await advance(600_000);
      expect(reads()).toHaveLength(20);
    } finally {
      view.unmount(); client.clear(); lifecycle.dispose(); await host.harness.lifecycle.dispose();
      if (previousVisibility) Object.defineProperty(document, "visibilityState", previousVisibility);
      else delete (document as { visibilityState?: string }).visibilityState;
    }
  });
});

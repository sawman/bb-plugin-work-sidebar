import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import { createGitHubPollingService } from "../server-polling";
import { rpcContract } from "../../../contracts";

describe("GitHub polling settings", () => {
  it("exposes background Off as 0ms while preserving active cadence, defaults and existing numeric values", async () => {
    const host = createFakePluginHost();
    const read = vi.fn(async () => "{}");
    const service = createGitHubPollingService(host.bb, read);
    host.bb.rpc.register({ getGitHubPollingPolicy: rpcContract.getGitHubPollingPolicy }, {
      getGitHubPollingPolicy: service.getGitHubPollingPolicy,
    });
    try {
      expect(await host.harness.behavior.callRpc("getGitHubPollingPolicy", null)).toEqual({ activePollMs: 60_000, backgroundPollMs: 300_000, maxRestPollsPerMinute: 30 });
      await host.harness.behavior.setSettings({ githubBackgroundPollSeconds: "0" });
      expect(await host.harness.behavior.callRpc("getGitHubPollingPolicy", null)).toEqual({ activePollMs: 60_000, backgroundPollMs: 0, maxRestPollsPerMinute: 30 });
      await host.harness.behavior.setSettings({ githubBackgroundPollSeconds: "900", githubActivePollSeconds: "300" });
      expect(await host.harness.behavior.callRpc("getGitHubPollingPolicy", null)).toEqual({ activePollMs: 300_000, backgroundPollMs: 900_000, maxRestPollsPerMinute: 30 });
      expect(read).not.toHaveBeenCalled();
    } finally { await host.harness.lifecycle.dispose(); }
  });
});

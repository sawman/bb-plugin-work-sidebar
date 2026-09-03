import { describe, expect, it, vi } from "vitest";
import { createWorkContextRegistration } from "../server-registration";
import { createProviderStatusReadService } from "../provider-status-server";
import { createServerLifecycle } from "../../../server-lifecycle";

describe("Work provider status server read", () => {
  it("reads provider state and subscription usage for the selected provider", async () => {
    const providerStates = vi.fn(async () => ({
      providers: [{
        providerId: "codex",
        displayName: "Codex",
        status: "ready" as const,
        statusMessage: null,
      }],
    }));
    const usageLimits = vi.fn(async () => ({
      codex: {
        status: "ok" as const,
        accountEmail: null,
        planLabel: "Pro",
        windows: [{ label: "Weekly", resetsAt: null, usedPercent: 83 }],
      },
    }));
    const registration = createWorkContextRegistration({
      bb: {
        events: { on: vi.fn() },
        storage: { kv: { get: vi.fn(), set: vi.fn() } },
        realtime: { publish: vi.fn() },
        sdk: {
          threads: {
            get: vi.fn(async ({ threadId }) => ({
              id: threadId,
              environmentId: "env_usage",
              providerId: "codex",
            })),
          },
          system: { providerStates, usageLimits },
        },
      } as never,
      lifecycle: createServerLifecycle(),
      tasks: {} as never,
    });

    await expect(
      registration.getWorkProviderStatus({ threadId: "thr_usage" }),
    ).resolves.toMatchObject({
      tone: "amber",
      providerName: "Codex",
      usage: {
        status: "ok",
        planLabel: "Pro",
        windows: [{ label: "Weekly", usedPercent: 83 }],
      },
    });
    expect(providerStates).toHaveBeenCalledExactlyOnceWith({});
    expect(usageLimits).toHaveBeenCalledExactlyOnceWith({ providerId: "codex" });

    await registration.getWorkProviderStatus({
      providerId: "codex",
    });
    expect(providerStates).toHaveBeenCalledTimes(1);
    expect(usageLimits).toHaveBeenCalledTimes(1);

    await registration.getWorkProviderStatus({ threadId: "thr_same_provider" });
    expect(providerStates).toHaveBeenCalledTimes(1);
    expect(usageLimits).toHaveBeenCalledTimes(1);
  });
});

describe("provider status read cache", () => {
  it("shares a provider across worktrees without another thread read", async () => {
    const getThread = vi.fn();
    const providerStates = vi.fn(async () => ({
      providers: [{
        providerId: "codex",
        displayName: "Codex",
        status: "ready" as const,
        statusMessage: null,
      }],
    }));
    const usageLimits = vi.fn(async () => ({
      codex: { status: "ok" as const, planLabel: "Pro", windows: [] },
    }));
    const service = createProviderStatusReadService({
      getThread,
      providerStates,
      usageLimits,
    });

    await Promise.all([
      service.readIdentity("codex"),
      service.readIdentity("codex"),
    ]);

    expect(getThread).not.toHaveBeenCalled();
    expect(providerStates).toHaveBeenCalledOnce();
    expect(usageLimits).toHaveBeenCalledOnce();
  });

  it("dedupes a provider for one minute before refreshing it", async () => {
    let clock = 1_000;
    const providerStates = vi.fn(async () => ({
      providers: [{
        providerId: "codex",
        displayName: "Codex",
        status: "ready" as const,
        statusMessage: null,
      }],
    }));
    const usageLimits = vi.fn(async () => ({
      codex: {
        status: "ok" as const,
        planLabel: "Pro",
        windows: [],
      },
    }));
    const service = createProviderStatusReadService({
      getThread: vi.fn(async () => ({ providerId: "codex", environmentId: "env_one" })),
      providerStates,
      usageLimits,
      now: () => clock,
    });

    await Promise.all([service.read("thr_one"), service.read("thr_two")]);
    expect(providerStates).toHaveBeenCalledOnce();
    expect(usageLimits).toHaveBeenCalledOnce();

    clock += 60_000;
    await service.read("thr_three");
    expect(providerStates).toHaveBeenCalledTimes(2);
    expect(usageLimits).toHaveBeenCalledTimes(2);
  });
});

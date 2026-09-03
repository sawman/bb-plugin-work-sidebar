import { describe, expect, it, vi } from "vitest";
import { createWorkContextRegistration } from "../server-registration";

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
        storage: { kv: { get: vi.fn(), set: vi.fn() } },
        realtime: { publish: vi.fn() },
        sdk: {
          threads: {
            get: vi.fn(async () => ({
              id: "thr_usage",
              environmentId: "env_usage",
              providerId: "codex",
            })),
          },
          system: { providerStates, usageLimits },
        },
      } as never,
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
    expect(providerStates).toHaveBeenCalledExactlyOnceWith({
      environmentId: "env_usage",
    });
    expect(usageLimits).toHaveBeenCalledExactlyOnceWith({ providerId: "codex" });
  });
});

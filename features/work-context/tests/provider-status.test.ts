import { describe, expect, it } from "vitest";
import { projectProviderStatus } from "../provider-status";

const provider = {
  providerId: "codex",
  displayName: "Codex",
  status: "ready" as const,
  statusMessage: null,
};

function usage(usedPercent: number) {
  return {
    status: "ok" as const,
    planLabel: "Pro",
    windows: [{ label: "Five-hour", resetsAt: null, usedPercent }],
  };
}

describe("Work provider status projection", () => {
  it("escalates a healthy provider icon as usage approaches its limit", () => {
    expect(projectProviderStatus({ providerId: "codex", provider, usage: usage(79) }).tone).toBe("green");
    expect(projectProviderStatus({ providerId: "codex", provider, usage: usage(80) }).tone).toBe("amber");
    expect(projectProviderStatus({ providerId: "codex", provider, usage: usage(100) }).tone).toBe("red");
  });

  it("keeps health useful when usage or provider state is unavailable", () => {
    expect(projectProviderStatus({ providerId: "codex", provider, usage: null })).toMatchObject({
      tone: "green",
      usage: null,
    });
    expect(projectProviderStatus({ providerId: "new-provider", provider: null, usage: null })).toMatchObject({
      tone: "amber",
      status: "unavailable",
      providerName: "new-provider",
    });
  });
});

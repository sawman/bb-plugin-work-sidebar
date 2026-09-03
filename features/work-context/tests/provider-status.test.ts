import { describe, expect, it } from "vitest";
import {
  projectProviderStatus,
  providerHealthTooltip,
} from "../provider-status";

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

  it("summarizes only the colour reason in the icon tooltip", () => {
    expect(providerHealthTooltip(
      projectProviderStatus({ providerId: "codex", provider, usage: usage(79) }),
    )).toBe("Ready");
    expect(providerHealthTooltip(
      projectProviderStatus({ providerId: "codex", provider, usage: usage(84) }),
    )).toBe("84% used");
    expect(providerHealthTooltip(projectProviderStatus({
      providerId: "codex",
      provider: { ...provider, status: "expired" },
      usage: usage(84),
    }))).toBe("Down");
  });
});

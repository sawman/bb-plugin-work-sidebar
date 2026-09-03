import { describe, expect, it } from "vitest";
import {
  projectProviderStatus,
  providerHealthTooltip,
  providerLimitHeading,
} from "../provider-status";
import { adaptRuntimeThreadActivity } from "../../../shared/thread-activity";

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
  it("keeps provider health distinct from thread runtime activity", () => {
    const health = projectProviderStatus({
      providerId: "codex",
      provider,
      usage: usage(12),
    });
    const activity = adaptRuntimeThreadActivity({
      status: "error",
      runtimeStatus: "failed",
    });

    expect(health).toMatchObject({ tone: "green", status: "ready" });
    expect(activity).toMatchObject({ state: "blocked", label: "Blocked" });
  });

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
    expect(providerHealthTooltip(
      projectProviderStatus({ providerId: "codex", provider, usage: usage(100) }),
    )).toBe("100% used");
  });

  it.each([
    ["not_installed", "Not installed"],
    ["unauthenticated", "Sign in"],
    ["expired", "Expired"],
    ["unsupported_version", "Update needed"],
    ["unknown", "Unavailable"],
    ["unavailable", "Unavailable"],
  ] as const)("describes %s provider state as %s", (status, label) => {
    expect(providerHealthTooltip(projectProviderStatus({
      providerId: "codex",
      provider: { ...provider, status },
      usage: usage(84),
    }))).toBe(label);
  });

  it("formats compact provider reset headings", () => {
    const now = Date.UTC(2026, 8, 3, 12);
    expect(providerLimitHeading("Weekly", null, now)).toBe("Weekly limit");
    expect(providerLimitHeading(
      "Five-hour",
      new Date(now + 42 * 60_000).toISOString(),
      now,
    )).toBe("Five-hour limit · resets in 42m");
    expect(providerLimitHeading(
      "Weekly limit",
      new Date(now + 3 * 60 * 60_000).toISOString(),
      now,
    )).toBe("Weekly limit · resets in 3h");
    expect(providerLimitHeading(
      "Monthly",
      new Date(now + 2 * 24 * 60 * 60_000).toISOString(),
      now,
    )).toBe("Monthly limit · resets in 2d");
  });
});

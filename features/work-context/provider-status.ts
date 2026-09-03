import type { WorkProviderStatus } from "./schemas.js";

const PROVIDER_STATUS_URLS: Readonly<Record<string, string>> = {
  codex: "https://status.openai.com/",
  "claude-code": "https://status.claude.com/",
  "acp-cursor": "https://status.cursor.com/",
};

type ProviderState = {
  providerId: string;
  displayName: string;
  status: WorkProviderStatus["status"];
  statusMessage: string | null;
};

type ProviderUsage =
  | {
      status: "ok";
      planLabel: string | null;
      windows: readonly {
        label: string;
        resetsAt: string | null;
        usedPercent: number;
      }[];
    }
  | { status: "not_installed" | "unauthenticated" | "expired" }
  | {
      status: "error";
      accountEmail?: string | null;
      planLabel?: string | null;
      message: string;
    };

function unavailableUsageMessage(status: ProviderUsage["status"]) {
  if (status === "not_installed") return "Usage unavailable: provider not installed.";
  if (status === "unauthenticated") return "Usage unavailable: provider not signed in.";
  if (status === "expired") return "Usage unavailable: provider session expired.";
  return "Usage is unavailable.";
}

export function projectProviderStatus({
  providerId,
  provider,
  usage,
}: {
  providerId: string;
  provider: ProviderState | null;
  usage: ProviderUsage | null;
}): WorkProviderStatus {
  const normalizedUsage: WorkProviderStatus["usage"] = usage?.status === "ok"
    ? {
        status: "ok",
        planLabel: usage.planLabel,
        message: null,
        windows: usage.windows.map((window) => ({
          label: window.label,
          resetsAt: window.resetsAt,
          usedPercent: window.usedPercent,
        })),
      }
    : usage
      ? {
          status: "unavailable",
          planLabel: usage.status === "error" ? (usage.planLabel ?? null) : null,
          message: usage.status === "error"
            ? usage.message
            : unavailableUsageMessage(usage.status),
          windows: [],
        }
      : null;
  const maximumUsage = normalizedUsage?.status === "ok"
    ? Math.max(0, ...normalizedUsage.windows.map((window) => window.usedPercent))
    : 0;
  const providerTone = !provider || provider.status === "unknown"
    ? "amber"
    : provider.status === "ready"
      ? "green"
      : "red";
  const tone = maximumUsage >= 100
    ? "red"
    : maximumUsage >= 80 && providerTone !== "red"
      ? "amber"
      : providerTone;
  return {
    tone,
    providerId,
    providerName: provider?.displayName ?? providerId,
    statusUrl: PROVIDER_STATUS_URLS[providerId] ?? null,
    status: provider?.status ?? "unavailable",
    message: provider?.statusMessage ?? (provider
      ? null
      : "Provider health is not available from this host."),
    usage: normalizedUsage,
  };
}

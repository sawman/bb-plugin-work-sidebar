import type { CSSProperties } from "react";
import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { ThreadProviderLogo } from "../../components/threads/thread-provider-logo";
import { ActionTooltip } from "../../components/ui/action-tooltip";
import { Icon } from "../../components/ui/icon";
import { readableStatus } from "../../work-model";
import {
  providerHealthTooltip,
  providerLimitHeading,
} from "./provider-status";
import type { WorkProviderStatus } from "./schemas";

type ProviderLogo = Parameters<typeof ThreadProviderLogo>[0]["provider"];

function usageTone(usedPercent: number) {
  if (usedPercent >= 100) return "critical";
  if (usedPercent >= 80) return "warning";
  return "normal";
}

function maximumUsage(provider: WorkProviderStatus) {
  if (provider.usage?.status !== "ok") return null;
  return Math.max(0, ...provider.usage.windows.map((window) => window.usedPercent));
}

export function ProviderHealth({
  provider,
  providerLogo,
}: {
  provider: WorkProviderStatus;
  providerLogo?: ProviderLogo;
}) {
  const navigate = useBbNavigate();
  const maximum = maximumUsage(provider);
  const accessibleLabel = `${provider.providerName} provider status: ${readableStatus(provider.status)}${
    maximum === null ? "" : ` · ${Math.round(maximum)}% used`
  }`;
  const tooltipLabel = providerHealthTooltip(provider);
  const icon = (
    <span aria-hidden className="ws-provider-health-icon">
      <ThreadProviderLogo
        providerId={provider.providerId}
        provider={providerLogo}
        runtimeState="idle"
      />
    </span>
  );
  const className = `ws-provider-health ws-provider-health-${provider.tone}`;
  return provider.statusUrl ? (
    <ActionTooltip label={tooltipLabel}>
      {(tooltipId) => (
        <button
          type="button"
          className={className}
          aria-label={accessibleLabel}
          aria-describedby={tooltipId}
          onClick={() => navigate.openUrl(provider.statusUrl!)}
        >
          {icon}
        </button>
      )}
    </ActionTooltip>
  ) : (
    <ActionTooltip label={tooltipLabel}>
      {(tooltipId) => (
        <span
          className={className}
          role="img"
          aria-label={accessibleLabel}
          aria-describedby={tooltipId}
        >
          {icon}
        </span>
      )}
    </ActionTooltip>
  );
}

export function ProviderStatusSection({
  provider,
}: {
  provider: WorkProviderStatus;
}) {
  const status = readableStatus(provider.status);
  return (
    <details className="ws-provider-status-section">
      <summary>
        <span className="ws-provider-status-title">
          <Icon name="ChevronRight" aria-hidden />
          Provider
        </span>
        <span className="ws-provider-status-summary">
          {provider.providerName}
          {provider.usage?.planLabel ? ` ${provider.usage.planLabel}` : ""} · {status}
        </span>
      </summary>
      <div className="ws-provider-status-content">
        {provider.message ? (
          <p className="ws-provider-status-message">{provider.message}</p>
        ) : null}
        {provider.usage?.status === "ok" ? (
          provider.usage.windows.length ? (
            <div className="ws-provider-usage-list">
              {provider.usage.windows.map((window) => {
                const percentage = Math.max(0, Math.min(100, window.usedPercent));
                return (
                  <div className="ws-provider-usage" key={window.label}>
                    <span>{providerLimitHeading(window.label, window.resetsAt)}</span>
                    <span>{Math.round(window.usedPercent)}%</span>
                    <span
                      className="ws-provider-usage-track"
                      role="progressbar"
                      aria-label={`${window.label} usage`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(percentage)}
                      data-tone={usageTone(window.usedPercent)}
                    >
                      <span
                        className="ws-provider-usage-fill"
                        style={{ "--ws-provider-usage": `${percentage}%` } as CSSProperties}
                      />
                    </span>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="ws-provider-status-message">No usage windows reported.</p>
          )
        ) : provider.usage?.message ? (
          <p className="ws-provider-status-message">{provider.usage.message}</p>
        ) : (
          <p className="ws-provider-status-message">Usage is not reported by this provider.</p>
        )}
      </div>
    </details>
  );
}

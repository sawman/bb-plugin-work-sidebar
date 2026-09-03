import type { PluginProvidersState } from "@get-bb/plugin-sdk/app";
import { useQuery } from "@tanstack/react-query";
import type { CSSProperties } from "react";
import { queryKeys, queryPolicies } from "@/query-runtime";
import { Icon } from "../ui/icon";
import { ActionTooltip } from "../ui/action-tooltip";

export type ThreadProvider = Pick<
  PluginProvidersState["providers"][number],
  "displayName" | "id" | "logoUrl"
>;

export type ThreadProviderDirectory = ReadonlyMap<string, ThreadProvider>;
export type ThreadProviderRuntimeState =
  "idle" | "working" | "stale" | "waiting" | "error" | "complete";

function readBlobAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Provider logo did not decode as an image."));
    });
    reader.addEventListener("error", () =>
      reject(reader.error ?? new Error("Provider logo could not be decoded.")),
    );
    reader.readAsDataURL(blob);
  });
}

async function loadProviderLogo(logoUrl: string): Promise<string> {
  const response = await fetch(logoUrl, { credentials: "same-origin" });
  if (!response.ok)
    throw new Error(`Provider logo request failed (${response.status}).`);
  return readBlobAsDataUrl(await response.blob());
}

function CachedProviderImage({ logoUrl }: { logoUrl: string }) {
  const logo = useQuery({
    queryKey: queryKeys.assets.providerLogo(logoUrl),
    queryFn: () => loadProviderLogo(logoUrl),
    ...queryPolicies.providerLogo,
  });
  if (!logo.data) return null;
  return (
    <span
      className="ws-thread-provider-mark"
      aria-hidden
      style={
        {
          "--ws-thread-provider-logo": `url("${logo.data}")`,
        } as CSSProperties
      }
    />
  );
}

export function ThreadProviderLogo({
  providerId,
  provider,
  title,
  runtimeState = "idle",
  statusLabel,
  tooltip = true,
}: {
  providerId: string;
  provider?: ThreadProvider;
  title?: string | null;
  runtimeState?: ThreadProviderRuntimeState;
  statusLabel?: string | null;
  /** The enclosing interactive control owns the tooltip when false. */
  tooltip?: boolean;
}) {
  const displayName = provider?.displayName ?? providerId;
  const accessibleLabel = `${displayName} provider${statusLabel ? ` status: ${statusLabel}` : ""}`;
  const tooltipLabel = title === undefined
    ? statusLabel
      ? accessibleLabel
      : displayName
    : title;
  const mark = (tooltipId?: string) => (
    <span
      className="ws-thread-provider"
      data-provider-id={providerId}
      data-runtime-state={runtimeState}
      role="img"
      aria-label={accessibleLabel}
      aria-describedby={tooltipId}
    >
      <span className="ws-thread-provider-glyph" aria-hidden>
        {provider?.logoUrl ? (
          <CachedProviderImage logoUrl={provider.logoUrl} />
        ) : null}
        <Icon name="Bot" className="ws-thread-provider-fallback" />
        <Icon
          name="Bot"
          className="ws-thread-provider-fallback-shine"
        />
      </span>
    </span>
  );
  if (!tooltip) return mark();
  return (
    <ActionTooltip label={tooltipLabel ?? displayName}>
      {(tooltipId) => mark(tooltipId)}
    </ActionTooltip>
  );
}

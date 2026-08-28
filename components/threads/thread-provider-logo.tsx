import type { PluginProvidersState } from "@get-bb/plugin-sdk/app";
import { useQuery } from "@tanstack/react-query";
import { queryKeys, queryPolicies } from "@/query-runtime";
import { Icon } from "../ui/icon";

export type ThreadProvider = Pick<
  PluginProvidersState["providers"][number],
  "displayName" | "id" | "logoUrl"
>;

export type ThreadProviderDirectory = ReadonlyMap<string, ThreadProvider>;

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
    <img
      src={logo.data}
      alt=""
      aria-hidden
      draggable={false}
      onError={(event) => {
        event.currentTarget.hidden = true;
      }}
    />
  );
}

export function ThreadProviderLogo({
  providerId,
  provider,
}: {
  providerId: string;
  provider?: ThreadProvider;
}) {
  const displayName = provider?.displayName ?? providerId;
  return (
    <span
      className="ws-thread-provider"
      data-provider-id={providerId}
      role="img"
      aria-label={`${displayName} provider`}
      title={displayName}
    >
      {provider?.logoUrl ? <CachedProviderImage logoUrl={provider.logoUrl} /> : null}
      <Icon name="Bot" aria-hidden />
    </span>
  );
}

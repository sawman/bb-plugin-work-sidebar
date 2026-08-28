import type { PluginProvidersState } from "@get-bb/plugin-sdk/app";
import { Icon } from "../ui/icon";

export type ThreadProvider = Pick<
  PluginProvidersState["providers"][number],
  "displayName" | "id" | "logoUrl"
>;

export type ThreadProviderDirectory = ReadonlyMap<string, ThreadProvider>;

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
      {provider?.logoUrl && (
        <img
          src={provider.logoUrl}
          alt=""
          aria-hidden
          draggable={false}
          onError={(event) => {
            event.currentTarget.hidden = true;
          }}
        />
      )}
      <Icon name="Bot" aria-hidden />
    </span>
  );
}

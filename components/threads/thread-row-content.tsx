import type { ReactNode } from "react";
import {
  ThreadProviderLogo,
  type ThreadProvider,
} from "./thread-provider-logo";

export function ThreadRowContent({
  leading,
  providerId,
  provider,
  title,
  attention,
  metadata,
  trailing,
}: {
  leading?: ReactNode;
  providerId: string;
  provider?: ThreadProvider;
  title: string;
  attention?: boolean;
  metadata: ReactNode;
  trailing: ReactNode;
}) {
  return (
    <>
      <span className="ws-thread-leading">
        {leading ?? (
          <span className="ws-thread-agent-placeholder" aria-hidden />
        )}
      </span>
      <span className="ws-thread-main ws-sidebar-row-main">
        <span className={`ws-thread-title ws-sidebar-row-title ${attention ? "ws-thread-attention" : ""}`}>
          <ThreadProviderLogo providerId={providerId} provider={provider} />
          <span className="ws-thread-title-copy">{title}</span>
        </span>
        {metadata}
      </span>
      {trailing}
    </>
  );
}

import type { ProviderRetry } from "./schemas";
import { useMemo } from "react";
import {
  useProviderRetries,
  useProviderRetryInvalidation,
} from "./queries";

export function providerRetryCountdown(
  retry: ProviderRetry,
  now: number,
): string {
  if (retry.sendAt === null) return "Queued";
  const remaining = Math.max(0, retry.sendAt - now);
  const seconds = Math.ceil(remaining / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function providerRetryLabel(retry: ProviderRetry, now: number): string {
  const countdown = providerRetryCountdown(retry, now);
  const attempt = retry.attempt === 1 ? "first retry" : `retry ${retry.attempt}`;
  return retry.sendAt === null
    ? `${retry.reason}; ${attempt} is queued.`
    : `${retry.reason}; ${attempt} in ${countdown}.`;
}

/** The left sidebar is the sole owner of provider-retry realtime updates. */
export function useSidebarProviderRetries(active: boolean) {
  const providerRetries = useProviderRetries(active);
  useProviderRetryInvalidation();
  return useMemo(
    () =>
      new Map(
        (providerRetries.data ?? []).map((retry) => [retry.threadId, retry]),
      ),
    [providerRetries.data],
  );
}

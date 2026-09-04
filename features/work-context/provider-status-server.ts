import { projectProviderStatus } from "./provider-status.js";
import type { WorkProviderStatus } from "./schemas.js";

const PROVIDER_HEALTH_REFRESH_MS = 60_000;

type ProviderState = {
  providerId: string;
  displayName: string;
  status: WorkProviderStatus["status"];
  statusMessage: string | null;
};

type ProviderUsage =
  | {
      status: "ok";
      accountEmail?: string | null;
      planLabel: string | null;
      windows: readonly { label: string; resetsAt: string | null; usedPercent: number }[];
    }
  | {
      status: "not_installed" | "unauthenticated" | "expired";
    }
  | {
      status: "error";
      accountEmail?: string | null;
      planLabel?: string | null;
      message: string;
    };

type ProviderStatusDependencies = {
  getThread(threadId: string): Promise<{
    environmentId?: string | null;
    providerId: string;
  }>;
  providerStates(environmentId: string | null): Promise<{
    providers: readonly ProviderState[];
  }>;
  usageLimits(providerId: string): Promise<Record<string, ProviderUsage | null | undefined>>;
  now?(): number;
};

type CacheEntry = {
  expiresAt: number;
  value: WorkProviderStatus;
};

/**
 * Provider health and usage are provider-wide. Cache their combined projection
 * once per provider so switching worktrees cannot create a cold duplicate.
 */
export function createProviderStatusReadService({
  getThread,
  providerStates,
  usageLimits,
  now = Date.now,
}: ProviderStatusDependencies) {
  const cache = new Map<string, CacheEntry>();
  const pending = new Map<string, Promise<WorkProviderStatus>>();
  const keyFor = (providerId: string) => providerId;

  const readScope = async (providerId: string) => {
    const key = keyFor(providerId);
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now()) return cached.value;
    const inFlight = pending.get(key);
    if (inFlight) return inFlight;

    const request = Promise.allSettled([
      providerStates(null),
      usageLimits(providerId),
    ])
      .then(([statesResult, usageResult]) => {
        const provider = statesResult.status === "fulfilled"
          ? statesResult.value.providers.find((candidate) => candidate.providerId === providerId) ?? null
          : {
              providerId,
              displayName: providerId,
              status: "unknown" as const,
              statusMessage: statesResult.reason instanceof Error
                ? statesResult.reason.message
                : "Provider health could not be checked.",
            };
        const value = projectProviderStatus({
          providerId,
          provider,
          usage: usageResult.status === "fulfilled"
            ? (usageResult.value[providerId] ?? null)
            : null,
        });
        cache.set(key, { value, expiresAt: now() + PROVIDER_HEALTH_REFRESH_MS });
        return value;
      })
      .finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  };

  return {
    /**
     * Exposes a fresh lifecycle-owned value without starting a read. Work
     * status uses this to include a warm provider snapshot without making
     * its own card response wait on provider usage I/O.
     */
    peekIdentity(providerId: string) {
      const cached = cache.get(keyFor(providerId));
      return cached && cached.expiresAt > now() ? cached.value : undefined;
    },
    readIdentity(providerId: string) {
      return readScope(providerId);
    },
    async read(threadId: string) {
      const thread = await getThread(threadId);
      return readScope(thread.providerId);
    },
  };
}

import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { projectBackgroundJobs } from "./background-jobs-server.js";
import { projectLatestActivity } from "./latest-activity.js";

type WorkTimeline = Awaited<
  ReturnType<BbPluginApi["sdk"]["threads"]["timeline"]>
>;
type CacheEntry<T> = { expiresAt: number; value: T };
type PendingEntry<T> = { generation: number; promise: Promise<T> };

export const WORK_TIMELINE_SNAPSHOT_TTL_MS = 1_000;
export const MAX_WORK_TIMELINE_SNAPSHOTS = 64;

export function selectWorkGoal(timeline: WorkTimeline) {
  return timeline.goal
    ? {
        objective: timeline.goal.objective,
        status: timeline.goal.status,
        tokensUsed: timeline.goal.tokensUsed,
        tokenBudget: timeline.goal.tokenBudget,
        timeUsedSeconds: timeline.goal.timeUsedSeconds,
      }
    : null;
}

export function selectWorkPlan(timeline: WorkTimeline) {
  return { items: timeline.pendingTodos?.items ?? [] };
}

export function selectWorkBackgroundJobs(timeline: WorkTimeline) {
  return projectBackgroundJobs(timeline);
}

export function selectLatestActivity(
  timeline: WorkTimeline,
  latestAssistant: string | null,
  hasCurrentTurn: boolean,
) {
  return projectLatestActivity(timeline.rows, latestAssistant, hasCurrentTurn);
}

export function createWorkTimelineSnapshotService<T = WorkTimeline>({
  timeline,
  now = Date.now,
  ttlMs = WORK_TIMELINE_SNAPSHOT_TTL_MS,
  maxEntries = MAX_WORK_TIMELINE_SNAPSHOTS,
}: {
  timeline(input: { threadId: string }): Promise<T>;
  now?(): number;
  ttlMs?: number;
  maxEntries?: number;
}) {
  const cache = new Map<string, CacheEntry<T>>();
  const pending = new Map<string, PendingEntry<T>>();
  const generations = new Map<string, number>();
  const inFlight = new Map<string, Set<PendingEntry<T>>>();
  let disposed = false;

  const prune = (time: number) => {
    for (const [threadId, entry] of cache)
      if (entry.expiresAt <= time) cache.delete(threadId);
  };

  const store = (threadId: string, value: T) => {
    const time = now();
    prune(time);
    if (!cache.has(threadId) && cache.size >= maxEntries)
      cache.delete(cache.keys().next().value!);
    cache.set(threadId, { value, expiresAt: time + ttlMs });
  };

  const read = (threadId: string): Promise<T> => {
    if (disposed)
      return Promise.reject(
        new Error("Work timeline snapshot service is disposed."),
      );
    const time = now();
    prune(time);
    const cached = cache.get(threadId);
    if (cached) {
      cache.delete(threadId);
      cache.set(threadId, cached);
      return Promise.resolve(cached.value);
    }
    const generation = generations.get(threadId) ?? 0;
    const existing = pending.get(threadId);
    if (existing?.generation === generation) return existing.promise;

    let load: Promise<T>;
    try {
      load = Promise.resolve(timeline({ threadId }));
    } catch (error) {
      load = Promise.reject(error);
    }
    let entry!: PendingEntry<T>;
    const promise = load
      .then((value) => {
        if (disposed)
          throw new Error("Work timeline snapshot service is disposed.");
        if ((generations.get(threadId) ?? 0) === generation)
          store(threadId, value);
        return value;
      })
      .finally(() => {
        if (pending.get(threadId) === entry) pending.delete(threadId);
        const entries = inFlight.get(threadId);
        entries?.delete(entry);
        if (entries?.size) return;
        inFlight.delete(threadId);
        generations.delete(threadId);
      });
    entry = { generation, promise };
    pending.set(threadId, entry);
    const entries = inFlight.get(threadId) ?? new Set<PendingEntry<T>>();
    entries.add(entry);
    inFlight.set(threadId, entries);
    return promise;
  };

  return {
    read,
    invalidate(threadId: string) {
      if (disposed) return;
      if (inFlight.get(threadId)?.size)
        generations.set(threadId, (generations.get(threadId) ?? 0) + 1);
      else generations.delete(threadId);
      cache.delete(threadId);
      pending.delete(threadId);
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cache.clear();
      pending.clear();
      generations.clear();
      inFlight.clear();
    },
    has(threadId: string) {
      prune(now());
      return cache.has(threadId);
    },
    inspect() {
      prune(now());
      return {
        disposed,
        cached: cache.size,
        pending: pending.size,
        generations: generations.size,
      };
    },
  };
}

export type WorkTimelineSnapshotService = ReturnType<
  typeof createWorkTimelineSnapshotService<WorkTimeline>
>;

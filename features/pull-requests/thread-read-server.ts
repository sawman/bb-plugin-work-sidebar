/** Coalesces concurrent thread reads only. No settled data or timers survive. */
export function createThreadReadService<T>(load: (threadId: string) => Promise<T>) {
  const pending = new Map<string, Promise<T>>();
  let disposed = false;
  return {
    read(threadId: string): Promise<T> {
      if (disposed) return Promise.reject(new Error("PR service is disposed."));
      const existing = pending.get(threadId);
      if (existing) return existing;
      const request = Promise.resolve().then(() => {
        if (disposed) throw new Error("PR service is disposed.");
        if (pending.get(threadId) !== request)
          throw new Error("Thread PR changed during the read. Retry the operation.");
        return load(threadId);
      }).then((result) => {
        if (disposed) throw new Error("PR service is disposed.");
        if (pending.get(threadId) !== request)
          throw new Error("Thread PR changed during the read. Retry the operation.");
        return result;
      }).finally(() => {
        if (pending.get(threadId) === request) pending.delete(threadId);
      });
      pending.set(threadId, request);
      return request;
    },
    invalidateAll() { pending.clear(); },
    invalidate(threadId: string) { pending.delete(threadId); },
    dispose() { disposed = true; pending.clear(); },
    inspect() { return { pending: pending.size, disposed }; },
  };
}

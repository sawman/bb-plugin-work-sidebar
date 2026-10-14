/** Timer-free bounded remote cache. Invalidation retires pending generations. */
export function createRemoteCache<T>(options: {
  ttlMs?: number; maxEntries?: number; maxBytes?: number; now?: () => number;
} = {}) {
  const ttlMs = options.ttlMs ?? 30_000;
  const maxEntries = options.maxEntries ?? 128;
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
  const now = options.now ?? Date.now;
  const entries = new Map<string, { value: T; expiresAt: number; bytes: number }>();
  const pending = new Map<string, Promise<T>>();
  let bytes = 0;
  let inFlight = 0;
  let disposed = false;
  function remove(key: string) {
    bytes -= entries.get(key)?.bytes ?? 0;
    entries.delete(key);
  }
  function prune() {
    for (const [key, entry] of entries) if (entry.expiresAt <= now()) remove(key);
  }
  function put(key: string, value: T, expiresAt = now() + ttlMs) {
    if (disposed) return;
    prune(); remove(key);
    if (expiresAt <= now()) return;
    const size = Buffer.byteLength(JSON.stringify(value));
    if (size > maxBytes) return;
    while (entries.size >= maxEntries || bytes + size > maxBytes)
      remove(entries.keys().next().value!);
    entries.set(key, { value, bytes: size, expiresAt }); bytes += size;
  }
  return {
    put,
    alias(sourceKey: string, aliasKey: string) {
      prune(); const source = entries.get(sourceKey);
      if (source && sourceKey !== aliasKey) put(aliasKey, source.value, source.expiresAt);
    },
    peek(key: string) { prune(); return entries.get(key)?.value; },
    select(prefix: string) { prune(); return [...entries].filter(([key]) => key.startsWith(prefix)).map(([, entry]) => entry.value); },
    read(key: string, load: () => Promise<T>, accept: (value: T) => boolean = () => true,
      policy: { expiresAt?: () => number; reuse?: (value: T) => boolean } = {},
    ): Promise<T> {
      if (disposed) return Promise.reject(new Error("Remote cache is disposed."));
      prune();
      const cached = entries.get(key);
      if (cached && (policy.reuse?.(cached.value) ?? true)) { entries.delete(key); entries.set(key, cached); return Promise.resolve(cached.value); }
      const existing = pending.get(key);
      if (existing) return existing;
      if (inFlight >= maxEntries) return Promise.reject(new Error("Remote read capacity reached."));
      inFlight++;
      const request = Promise.resolve().then(() => {
        if (disposed || pending.get(key) !== request) throw new Error("Remote data changed during the read.");
        return load();
      }).then((value) => {
        if (disposed || pending.get(key) !== request) throw new Error("Remote data changed during the read.");
        if (accept(value)) put(key, value, policy.expiresAt?.());
        return value;
      }).finally(() => { inFlight--; if (pending.get(key) === request) pending.delete(key); });
      pending.set(key, request); return request;
    },
    invalidate(prefix = "") {
      for (const key of entries.keys()) if (key.startsWith(prefix)) remove(key);
      for (const key of pending.keys()) if (key.startsWith(prefix)) pending.delete(key);
    },
    dispose() { disposed = true; entries.clear(); pending.clear(); bytes = 0; },
    inspect() { prune(); return { entries: entries.size, pending: pending.size, bytes, disposed }; },
  };
}

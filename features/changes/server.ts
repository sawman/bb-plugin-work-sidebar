import type { Changes, Repository } from "./schemas.js";

export type ChangesServiceDependencies = {
  repository(threadId: string): Promise<Repository>;
  projection(threadId: string): Promise<Omit<Changes, "repository">>;
  fingerprint(threadId: string, url: string): Promise<{ fingerprint: string | null }>;
};

/** Thread-specific adapter: repository state and PR stack are one Changes projection. */
export function createChangesService(dependencies: ChangesServiceDependencies) {
  return {
    async get(threadId: string): Promise<Changes> {
      const [repository, projection] = await Promise.all([dependencies.repository(threadId), dependencies.projection(threadId)]);
      return { ...projection, repository };
    },
    fingerprint(threadId: string, url: string) { return dependencies.fingerprint(threadId, url); },
  };
}

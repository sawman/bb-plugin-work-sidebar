export const STORAGE_ENTRY_LIMIT = 200;
const MAX_PATH_LENGTH = 1024;
const MAX_DEPTH = 20;

export type StorageEntry = Readonly<{
  kind: "directory" | "file";
  name: string;
  path: string;
  parent: string;
}>;
export type StorageListing = Readonly<{
  entries: readonly StorageEntry[];
  truncated: boolean;
  unavailable: boolean;
}>;

export function safeStoragePath(path: string) {
  if (!path || path.length > MAX_PATH_LENGTH || /[\\\u0000-\u001f\u007f]/.test(path) || path.startsWith("/") || /^[a-zA-Z]:/.test(path)) return false;
  const segments = path.split("/");
  return segments.length <= MAX_DEPTH && segments.every((segment) => segment && segment !== "." && segment !== ".." && !/[\uD800-\uDFFF]/u.test(segment));
}

/** Bounded metadata projection. Host roots, scores and match positions never enter Query. */
export function projectStorageListing(response: {
  paths: readonly { path: string; kind: "directory" | "file" }[];
  truncated: boolean;
}): StorageListing {
  const entries = new Map<string, StorageEntry>();
  let truncated = response.truncated || response.paths.length > STORAGE_ENTRY_LIMIT;
  let unavailable = false;
  for (const entry of response.paths.slice(0, STORAGE_ENTRY_LIMIT)) {
    if (!safeStoragePath(entry.path)) { unavailable = true; continue; }
    const segments = entry.path.split("/");
    for (let index = 0; index < segments.length; index++) {
      const path = segments.slice(0, index + 1).join("/");
      if (entries.has(path)) continue;
      if (entries.size === STORAGE_ENTRY_LIMIT) { truncated = true; break; }
      entries.set(path, {
        path,
        parent: segments.slice(0, index).join("/"),
        name: segments[index]!,
        kind: index === segments.length - 1 ? entry.kind : "directory",
      });
    }
  }
  return {
    entries: [...entries.values()].sort((left, right) =>
      Number(right.kind === "directory") - Number(left.kind === "directory")
      || (left.name < right.name ? -1 : left.name > right.name ? 1 : 0)
      || (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)),
    truncated,
    unavailable,
  };
}

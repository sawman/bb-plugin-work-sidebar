import { z } from "zod";

const sidebarThreadGroup = z.object({
  id: z.string().regex(/^group_[a-z0-9_-]{1,48}$/),
  name: z.string().trim().min(1).max(40),
  threadIds: z.array(z.string().startsWith("thr_")).max(2_000),
});

const archivedThread = z.object({
  id: z.string().startsWith("thr_"),
  projectId: z.string(),
  title: z.string().nullable(),
  titleFallback: z.string().nullable(),
  parentThreadId: z.string().nullable(),
  providerId: z.string(),
  environmentBranchName: z.string().nullable(),
  environmentName: z.string().nullable(),
  environmentWorkspaceDisplayKind: z.enum([
    "managed-worktree",
    "unmanaged-worktree",
    "other",
  ]),
  isPinned: z.boolean(),
  isUnread: z.boolean(),
  createdAt: z.number(),
  updatedAt: z.number(),
  archivedAt: z.number(),
});

export const threadPreferenceSchemas = {
  getSidebarOrder: {
    input: z.null(),
    output: z.object({ threadIds: z.array(z.string()) }).strict(),
  },
  saveSiblingOrder: {
    input: z.object({ threadIds: z.array(z.string()) }).strict(),
    output: z.object({ threadIds: z.array(z.string()) }).strict(),
  },
  getLaterThreads: {
    input: z.null(),
    output: z
      .object({ threadIds: z.array(z.string().startsWith("thr_")) })
      .strict(),
  },
  saveLaterThreads: {
    input: z
      .object({ threadIds: z.array(z.string().startsWith("thr_")).max(2_000) })
      .strict(),
    output: z
      .object({ threadIds: z.array(z.string().startsWith("thr_")) })
      .strict(),
  },
  getThreadGroups: {
    input: z.null(),
    output: z.object({ groups: z.array(sidebarThreadGroup).max(12) }).strict(),
  },
  saveThreadGroups: {
    input: z.object({ groups: z.array(sidebarThreadGroup).max(12) }).strict(),
    output: z.object({ groups: z.array(sidebarThreadGroup).max(12) }).strict(),
  },
} as const;

export const threadArchiveSchemas = {
  sidebarArchivedThreads: {
    input: z.object({ force: z.boolean().optional() }).strict(),
    output: z
      .object({
        available: z.boolean(),
        threads: z.array(archivedThread),
        error: z.string().nullable(),
      })
      .strict(),
  },
  unarchiveSidebarThread: {
    input: z.object({ threadId: z.string().startsWith("thr_") }).strict(),
    output: z.object({ threadId: z.string().startsWith("thr_") }).strict(),
  },
} as const;

export const threadSchemas = {
  ...threadPreferenceSchemas,
  ...threadArchiveSchemas,
} as const;

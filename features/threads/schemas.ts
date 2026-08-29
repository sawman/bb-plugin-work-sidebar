import { z } from "zod";
import {
  MAX_SIDEBAR_ROW_HEIGHT,
  MIN_SIDEBAR_ROW_HEIGHT,
  MAX_TEXT_SCALE,
  MIN_TEXT_SCALE,
} from "./sidebar-appearance";

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
    output: z
      .object({
        groups: z.array(sidebarThreadGroup).max(12),
        activeGroupPosition: z.number().int().min(0).max(12).optional(),
      })
      .strict(),
  },
  saveThreadGroups: {
    input: z
      .object({
        groups: z.array(sidebarThreadGroup).max(12),
        activeGroupPosition: z.number().int().min(0).max(12).optional(),
      })
      .strict(),
    output: z
      .object({
        groups: z.array(sidebarThreadGroup).max(12),
        activeGroupPosition: z.number().int().min(0).max(12).optional(),
      })
      .strict(),
  },
  getSidebarAppearance: {
    input: z.null(),
    output: z
      .object({
        rowHeight: z
          .number()
          .min(MIN_SIDEBAR_ROW_HEIGHT)
          .max(MAX_SIDEBAR_ROW_HEIGHT),
        textScale: z.number().min(MIN_TEXT_SCALE).max(MAX_TEXT_SCALE),
      })
      .strict(),
  },
  saveSidebarAppearance: {
    input: z.union([
      z
        .object({
          rowHeight: z
            .number()
            .min(MIN_SIDEBAR_ROW_HEIGHT)
            .max(MAX_SIDEBAR_ROW_HEIGHT)
            .multipleOf(0.1),
        })
        .strict(),
      z
        .object({
          textScale: z
            .number()
            .min(MIN_TEXT_SCALE)
            .max(MAX_TEXT_SCALE)
            .multipleOf(0.01),
        })
        .strict(),
    ]),
    output: z
      .object({
        rowHeight: z
          .number()
          .min(MIN_SIDEBAR_ROW_HEIGHT)
          .max(MAX_SIDEBAR_ROW_HEIGHT),
        textScale: z.number().min(MIN_TEXT_SCALE).max(MAX_TEXT_SCALE),
      })
      .strict(),
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

export const threadHierarchySchemas = {
  moveSidebarThread: {
    input: z
      .object({
        threadId: z.string().startsWith("thr_"),
        parentThreadId: z.string().startsWith("thr_").nullable(),
      })
      .strict(),
    output: z
      .object({
        threadId: z.string().startsWith("thr_"),
        parentThreadId: z.string().startsWith("thr_").nullable(),
        oldRootThreadId: z.string().startsWith("thr_"),
        newRootThreadId: z.string().startsWith("thr_"),
        affectedThreadIds: z.array(z.string().startsWith("thr_")).min(1),
      })
      .strict(),
  },
} as const;

export const threadSchemas = {
  ...threadPreferenceSchemas,
  ...threadArchiveSchemas,
  ...threadHierarchySchemas,
} as const;

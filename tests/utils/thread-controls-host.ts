import { beforeEach, vi } from "vitest";
import type { RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";

export const lifecycleCalls: { method: string; threadId: string }[] = [];
beforeEach(() => { lifecycleCalls.length = 0; });

/** The SDK harness deliberately does not emulate BB's core confirmations. */
export const threadControlsHost = {
  sdk: {
    threads: {
      update: vi.fn(async () => ({}) as never),
      pin: vi.fn(async () => ({}) as never),
      unpin: vi.fn(async () => ({}) as never),
      markRead: vi.fn(async () => ({}) as never),
      markUnread: vi.fn(async () => ({}) as never),
    },
  },
  threadActions: (thread) => ["archive", "delete"].map((command) => ({
    key: `bb--core/${command}`,
    pluginId: "bb--core",
    group: "lifecycle",
    action: {
      label: command,
      icon: "Archive" as const,
      run: async () => {
        lifecycleCalls.push({ method: command === "delete" ? "requestDelete" : command, threadId: thread.id });
      },
    },
  })),
} satisfies Pick<RenderSlotOptions, "sdk" | "threadActions">;

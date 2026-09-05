import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import plugin, { createServerLifecycle, rpcContract } from "../../../server.js";
import { pluginStorageDatabase } from "../../../shared/server-storage.js";
import { createInboxLifecycleSubscription } from "../server-registration.js";

const thread = {
  id: "thr_inbox",
  projectId: "proj_inbox",
  archivedAt: null as string | null,
  providerId: "codex",
  title: "Inbox agent",
  titleFallback: null,
};

function toolText(output: unknown) {
  if (typeof output === "string") return output;
  if (output && typeof output === "object" && "content" in output && Array.isArray(output.content)) {
    const text = output.content.find(
      (part): part is { type: "text"; text: string } => Boolean(part) && typeof part === "object" && "type" in part && part.type === "text" && "text" in part && typeof part.text === "string",
    );
    if (text) return text.text;
  }
  throw new Error("Expected tool text output.");
}

describe("Inbox registration", () => {
  it("registers strict RPCs and provider-derived tools with one targeted signal", async () => {
    const host = createFakePluginHost({ sdk: { threads: { get: vi.fn(async () => thread) } } });
    await plugin(host.bb);
    expect(Object.keys(rpcContract)).toEqual(expect.arrayContaining([
      "listHumanMessages", "acknowledgeHumanMessage", "setHumanMessageBookmark",
    ]));
    expect(host.harness.inspection.registrations.agentTools.find(({ name }) => name === "leave_human_message")?.instructions).toBeNull();
    const created = await host.harness.behavior.callAgentTool("leave_human_message", {
      subject: "Decision", body: "Ship it", idempotencyKey: "inbox-retry",
    }, { threadId: thread.id, projectId: "proj_stale_context" });
    const messageId = JSON.parse(toolText(created)).id;
    expect(host.harness.inspection.realtimeSignals).toEqual([
      { channel: "work-sidebar:changed", payload: { family: "inbox", threadId: thread.id } },
    ]);
    const read = await host.harness.behavior.callAgentTool("read_human_messages", { messageId }, { threadId: thread.id, projectId: thread.projectId });
    const decoded = JSON.parse(toolText(read));
    expect(decoded).toMatchObject({ providerId: "codex", agentLabel: "Inbox agent" });
    await expect(host.harness.behavior.callRpc("listHumanMessages", { threadId: thread.id, extra: true } as never)).rejects.toMatchObject({ code: "invalid_input" });
    await host.harness.lifecycle.dispose();
  });

  it("purges archive/delete events once per exact thread and ignores them after disposal", () => {
    const handlers = new Map<string, (event: { thread: { id: string } }) => void>();
    const purge = vi.fn();
    const listener = createInboxLifecycleSubscription({
      subscribe: (event, handler) => handlers.set(event, handler), purge,
    });
    handlers.get("thread.archived")!({ thread: { id: "thr_one" } });
    handlers.get("thread.deleted")!({ thread: { id: "thr_two" } });
    listener.dispose();
    handlers.get("thread.archived")!({ thread: { id: "thr_after" } });
    expect(purge.mock.calls).toEqual([["thr_one"], ["thr_two"]]);
  });

  it("does not use stale storage or logging when deferred startup reconciliation settles after disposal", async () => {
    let resolveThread!: (value: typeof thread) => void;
    const get = vi.fn(() => new Promise<typeof thread>((resolve) => { resolveThread = resolve; }));
    const host = createFakePluginHost({ sdk: { threads: { get } } });
    const database = pluginStorageDatabase(host.bb);
    database.prepare(`INSERT INTO human_inbox_messages VALUES ('msg_late', 'thr_late', 'proj_late', NULL, 'body', NULL, NULL, NULL, '2026-09-06T00:00:00.000Z', '2026-09-06T00:00:00.000Z', NULL, NULL, 1, NULL)`).run();
    const lifecycle = createServerLifecycle();
    await plugin(host.bb, lifecycle);
    await vi.waitFor(() => expect(get).toHaveBeenCalledWith({ threadId: "thr_late" }));
    lifecycle.dispose();
    resolveThread({ ...thread, id: "thr_late", archivedAt: "2026-09-06T01:00:00.000Z" });
    await Promise.resolve();
    await Promise.resolve();
    expect(database.prepare("SELECT id FROM human_inbox_messages WHERE id = 'msg_late'").get()).toEqual({ id: "msg_late" });
    expect(host.harness.inspection.logEntries).toEqual([]);
    await host.harness.lifecycle.dispose();
  });
});

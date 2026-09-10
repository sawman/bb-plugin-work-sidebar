import { createFakePluginHost, makePluginAgentConfigurationContext } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import plugin, { createServerLifecycle, rpcContract } from "../../../server.js";
import { pluginStorageDatabase } from "../../../shared/server-storage.js";
import * as inboxService from "../server.js";
import { INBOX_AGENT_INSTRUCTIONS } from "../server.js";
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
  it("instructs agents to answer through Inbox and continue remaining work", async () => {
    const expected = "When the user asks a question and requested work still remains, leave the answer in Inbox and continue the work instead of stopping after the answer.";
    expect(INBOX_AGENT_INSTRUCTIONS).toContain(expected);

    const host = createFakePluginHost();
    await plugin(host.bb);
    const configuration = host.harness.inspection.registrations.agentConfigurationProvider?.(
      makePluginAgentConfigurationContext(),
    );
    expect(configuration?.instructions).toContain(expected);
    await host.harness.lifecycle.dispose();
  });

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

  it.each([
    ["title", "x".repeat(161), "x".repeat(160)],
    ["titleFallback", "x".repeat(500), "x".repeat(160)],
    ["title", "x".repeat(159) + "😀tail", "x".repeat(159)],
    ["titleFallback", "x".repeat(158) + "😀tail", "x".repeat(158) + "😀"],
  ])("bounds host %s metadata before storage and RPC output", async (source, label, expected) => {
    const hostThread = { ...thread, title: source === "title" ? label : null, titleFallback: label };
    const host = createFakePluginHost({ sdk: { threads: { get: async () => hostThread } } });
    try {
      await plugin(host.bb);
      const created = await host.harness.behavior.callAgentTool("leave_human_message", { body: "Ship it" }, { threadId: thread.id, projectId: thread.projectId });
      const messageId = JSON.parse(toolText(created)).id;
      expect(pluginStorageDatabase(host.bb).prepare("SELECT agent_label FROM human_inbox_messages WHERE id = ?").get(messageId)).toEqual({ agent_label: expected });
      const listed = await host.harness.behavior.callRpc("listHumanMessages", { threadId: thread.id });
      expect(listed).toMatchObject({ messages: [{ id: messageId, agentLabel: expected }] });
    } finally {
      await host.harness.lifecycle.dispose();
    }
  });

  it("normalizes existing oversized labels for list, read, retry and mutation output", async () => {
    const host = createFakePluginHost({ sdk: { threads: { get: async () => thread } } });
    try {
      await plugin(host.bb);
      const context = { threadId: thread.id, projectId: thread.projectId };
      const input = { body: "Legacy record", idempotencyKey: "legacy" };
      const created = await host.harness.behavior.callAgentTool("leave_human_message", input, context);
      const messageId = JSON.parse(toolText(created)).id;
      await host.harness.behavior.callAgentTool("leave_human_message", { body: "Healthy neighbor" }, context);
      pluginStorageDatabase(host.bb).prepare("UPDATE human_inbox_messages SET agent_label = ? WHERE id = ?").run("x".repeat(159) + "😀legacy", messageId);
      const listed = await host.harness.behavior.callRpc("listHumanMessages", { threadId: thread.id });
      expect(listed).toMatchObject({ messages: expect.arrayContaining([
        expect.objectContaining({ id: messageId, agentLabel: "x".repeat(159) }),
        expect.objectContaining({ body: "Healthy neighbor", agentLabel: "Inbox agent" }),
      ]) });
      const read = await host.harness.behavior.callAgentTool("read_human_messages", { messageId }, context);
      expect(JSON.parse(toolText(read)).agentLabel).toBe("x".repeat(159));
      const retry = await host.harness.behavior.callAgentTool("leave_human_message", input, context);
      expect(JSON.parse(toolText(retry)).id).toBe(messageId);
      const acknowledged = await host.harness.behavior.callRpc("acknowledgeHumanMessage", { threadId: thread.id, messageId });
      expect(acknowledged).toMatchObject({ agentLabel: "x".repeat(159) });
    } finally {
      await host.harness.lifecycle.dispose();
    }
  });

  it("does not publish realtime for an unchanged idempotent create retry", async () => {
    const host = createFakePluginHost({ sdk: { threads: { get: vi.fn(async () => thread) } } });
    await plugin(host.bb);
    const input = { subject: "Decision", body: "Ship it", idempotencyKey: "same-retry" };
    await host.harness.behavior.callAgentTool("leave_human_message", input, { threadId: thread.id, projectId: thread.projectId });
    await host.harness.behavior.callAgentTool("leave_human_message", input, { threadId: thread.id, projectId: thread.projectId });
    expect(host.harness.inspection.realtimeSignals).toHaveLength(1);
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

it.each([1, 2])("rejects pending create after registration disposal at lookup %s", async (boundary) => {
  let resolve!: (value: typeof thread) => void;
  let started!: () => void;
  const pending = new Promise<typeof thread>((done) => { resolve = done; });
  const entered = new Promise<void>((done) => { started = done; });
  let calls = 0;
  const get = vi.fn(() => {
    if (++calls === boundary) { started(); return pending; }
    return Promise.resolve(thread);
  });
  const host = createFakePluginHost({ sdk: { threads: { get } } });
  const lifecycle = createServerLifecycle();
  await plugin(host.bb, lifecycle);
  const database = pluginStorageDatabase(host.bb);
  const creating = host.harness.behavior.callAgentTool("leave_human_message", { body: "late" }, { threadId: thread.id, projectId: thread.projectId });
  await entered;
  lifecycle.dispose();
  const prepare = vi.spyOn(database, "prepare");
  resolve(thread);
  await expect(creating).rejects.toThrow(/disposed/);
  expect(prepare).not.toHaveBeenCalled();
  prepare.mockRestore();
  expect(database.prepare("SELECT * FROM human_inbox_messages").all()).toEqual([]);
  expect(get).toHaveBeenCalledTimes(boundary);
  expect(host.harness.inspection.realtimeSignals).toEqual([]);
  await host.harness.lifecycle.dispose();
});

it("does not publish when disposal follows commit before the tool continuation", async () => {
  const lifecycle = createServerLifecycle();
  const original = inboxService.createInboxService;
  const factory = vi.spyOn(inboxService, "createInboxService").mockImplementation((options) => {
    const service = original(options);
    const create = service.create.bind(service);
    service.create = async (input) => {
      const message = await create(input);
      lifecycle.dispose();
      return message;
    };
    return service;
  });
  const host = createFakePluginHost({ sdk: { threads: { get: async () => thread } } });
  try {
    await plugin(host.bb, lifecycle);
    const creating = host.harness.behavior.callAgentTool("leave_human_message", { body: "committed while active" }, { threadId: thread.id, projectId: thread.projectId });
    await expect(creating).rejects.toThrow(/disposed/);
    expect(host.harness.inspection.realtimeSignals).toEqual([]);
    expect(pluginStorageDatabase(host.bb).prepare("SELECT body FROM human_inbox_messages").all()).toEqual([{ body: "committed while active" }]);
  } finally {
    factory.mockRestore();
    await host.harness.lifecycle.dispose();
  }
});

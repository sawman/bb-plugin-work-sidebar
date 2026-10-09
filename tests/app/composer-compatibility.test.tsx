// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { ComposerAttachment, ComposerMention } from "@get-bb/plugin-sdk/app";

afterEach(cleanup);

async function trackSlot(createWorkTask: ReturnType<typeof vi.fn>, text: string, mentions: readonly ComposerMention[] = [], attachments: readonly ComposerAttachment[] = []) {
  const app = await loadPluginApp(() => import("../../app"));
  const registration = app.composerCustomizations[0]!.actions!.find((action) => action.id === "track-work")!;
  return renderSlot(registration, {}, {
    composer: { scope: { kind: "thread", threadId: "thr_track" }, text, mentions, attachments },
    rpc: { createWorkTask } as never,
  });
}

const result = { task: { key: "BBPLUG-415", title: "Compatibility 🧩" } };
const attachment: ComposerAttachment = {
  name: "notes.txt", path: "/thread-storage/notes.txt", mimeType: "text/plain", sizeBytes: 12, type: "localFile",
};

describe("task-first composer compatibility", () => {
  it("prefixes the newest draft and shifts mention pills without losing attachments", async () => {
    let finish!: (value: typeof result) => void;
    const createWorkTask = vi.fn(() => new Promise<typeof result>((complete) => { finish = complete; }));
    const mention: ComposerMention = { kind: "thread", threadId: "thr_reference", label: "Reference", from: 6, to: 16 };
    const slot = await trackSlot(createWorkTask, "First @Reference", [mention], [attachment]);
    fireEvent.click(slot.getByRole("button", { name: "Track this work as a task" }));
    expect(createWorkTask).toHaveBeenCalledWith({ threadId: "thr_track", title: "First @Reference", description: "First @Reference", parentTaskId: null });
    // Host editing during the RPC preserves the pill and moves its range.
    await slot.behavior.setComposerText("🧩 Newest @Reference");
    const latest = slot.inspection.composer.draft;
    await act(async () => { finish(result); });
    const prefix = "Work through BBPLUG-415: Compatibility 🧩.\n\n";
    await waitFor(() => expect(slot.inspection.composer.text).toBe(prefix + latest.text));
    expect(slot.inspection.composer.draft.mentions).toEqual(latest.mentions.map((pill) => ({ ...pill, from: pill.from + prefix.length, to: pill.to + prefix.length })));
    expect(slot.inspection.composer.draft.mentions).toHaveLength(1);
    const pill = slot.inspection.composer.draft.mentions[0]!;
    expect(slot.inspection.composer.text.slice(pill.from, pill.to)).toBe("@Reference");
    expect(slot.inspection.composer.draft.attachments).toEqual([attachment]);
    expect(slot.inspection.composer.submits).toEqual([]);
  });

  it("keeps the draft intact when task creation fails", async () => {
    const slot = await trackSlot(vi.fn().mockRejectedValue(new Error("Unavailable")), "Keep this", [], [attachment]);
    const before = slot.inspection.composer.draft;
    fireEvent.click(slot.getByRole("button", { name: "Track this work as a task" }));
    await act(async () => {});
    expect(slot.inspection.composer.draft).toEqual(before);
  });

  it("reads the reactive current draft when clicked", async () => {
    const createWorkTask = vi.fn().mockResolvedValue(result);
    const slot = await trackSlot(createWorkTask, "Old title");
    await slot.behavior.setComposerText("New title\nDescription");
    fireEvent.click(slot.getByRole("button", { name: "Track this work as a task" }));
    await waitFor(() => expect(createWorkTask).toHaveBeenCalledWith({ threadId: "thr_track", title: "New title", description: "New title\nDescription", parentTaskId: null }));
  });
});

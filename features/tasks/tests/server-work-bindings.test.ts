import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { publishWorkBindingReady } from "../server-work-bindings.js";

describe("work binding realtime publication", () => {
  it("publishes exactly the Work then Tasks envelopes for one root thread", () => {
    const published = vi.fn();
    const realtime = {
      publish: (channel: string, payload: unknown) =>
        published(channel, payload),
    };

    publishWorkBindingReady(realtime, "thr_root");

    expect(published.mock.calls).toEqual([
      ["work-sidebar:changed", { family: "work", threadId: "thr_root" }],
      ["work-sidebar:changed", { family: "tasks", threadId: "thr_root" }],
    ]);
  });

  it("uses the shared publisher after both direct and delegated ready paths", () => {
    const source = readFileSync(
      new URL("../server-work-bindings.ts", import.meta.url),
      "utf8",
    );

    expect(
      source.match(/publishWorkBindingReady\(bb\.realtime, root\.id\)/g),
    ).toHaveLength(2);
  });
});

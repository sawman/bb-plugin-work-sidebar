// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { useStore } from "zustand";
import { createThreadInteractionStore } from "../store";

describe("thread interaction store", () => {
  it("holds presentation state only, including expansion and drag target", () => {
    const store = createThreadInteractionStore();
    store.getState().toggleChildren("thr_a");
    store.getState().setDrag("thr_a", { threadId: "thr_b", placement: "before" });
    expect(store.getState().expandedThreadIds).toEqual(new Set(["thr_a"]));
    expect(store.getState().dragThreadId).toBe("thr_a");
    expect(store.getState().dropTarget).toEqual({ threadId: "thr_b", placement: "before" });
  });

  it("keeps Work view state per thread but does not persist across a new store/remount", () => {
    const store = createThreadInteractionStore();
    store.getState().setWorkTab("thr_a", "changes");
    store.getState().setWorkTab("thr_b", "agents");
    expect(store.getState().workTabFor("thr_a")).toBe("changes");
    expect(store.getState().workTabFor("thr_b")).toBe("agents");
    expect(createThreadInteractionStore().getState().workTabFor("thr_a")).toBe("work");
  });

  it("cleans departed roster entries and applies a deterministic 40-entry LRU cap", () => {
    const store = createThreadInteractionStore();
    for (let index = 0; index < 41; index += 1) store.getState().setWorkTab(`thr_${index}`, "changes");
    expect(store.getState().workTabFor("thr_0")).toBe("work");
    expect(store.getState().workTabFor("thr_1")).toBe("changes");
    store.getState().setSelected("thr_1", ["thr_1", "thr_2"]);
    store.getState().toggleChildren("thr_2");
    store.getState().setDrag("thr_2", { threadId: "thr_2", placement: "after" });
    store.getState().reconcileRoster(["thr_1"]);
    expect(store.getState().selectedThreadIds).toEqual(new Set(["thr_1"]));
    expect(store.getState().selectionAnchorId).toBe("thr_1");
    expect(store.getState().expandedThreadIds).toEqual(new Set());
    expect(store.getState().dragThreadId).toBeNull();
    expect(store.getState().dropTarget).toBeNull();
    expect(store.getState().workTabFor("thr_2")).toBe("work");
  });

  it("mounts selector consumers so left selection/drag and right tabs stay scoped", () => {
    const store = createThreadInteractionStore();
    function Characterization() {
      const selected = useStore(store, (state) => state.selectedThreadIds.has("thr_a"));
      const dragging = useStore(store, (state) => state.dragThreadId === "thr_a");
      const tabA = useStore(store, (state) => state.workTabsByThread.get("thr_a") ?? "work");
      const tabB = useStore(store, (state) => state.workTabsByThread.get("thr_b") ?? "work");
      return <>
        <button onClick={() => store.getState().setSelected("thr_a", ["thr_a"])}>{selected ? "selected" : "idle"}</button>
        <button onClick={() => store.getState().setDrag("thr_a", { threadId: "thr_b", placement: "before" })}>{dragging ? "dragging" : "still"}</button>
        <button aria-label="set thread A changes" onClick={() => store.getState().setWorkTab("thr_a", "changes")}>{tabA}</button>
        <output>{tabB}</output>
      </>;
    }
    const screen = render(<Characterization />);
    fireEvent.click(screen.getByText("idle"));
    fireEvent.click(screen.getByText("still"));
    fireEvent.click(screen.getByLabelText("set thread A changes"));
    expect(screen.getByText("selected")).toBeTruthy();
    expect(screen.getByText("dragging")).toBeTruthy();
    expect(screen.getByText("changes")).toBeTruthy();
    expect(screen.getByText("work")).toBeTruthy();
  });
});

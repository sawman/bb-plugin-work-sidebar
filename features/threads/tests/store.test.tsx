// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { memo } from "react";
import { fireEvent, render } from "@testing-library/react";
import { useStore } from "zustand";
import { createThreadInteractionStore } from "../store";

describe("thread interaction store", () => {
  it("holds presentation state only, including expansion and drag target", () => {
    const store = createThreadInteractionStore();
    store.getState().toggleChildren("thr_a");
    store.getState().setDrag("thr_a", {
      kind: "reorder",
      threadId: "thr_b",
      placement: "before",
    });
    expect(store.getState().expandedThreadIds).toEqual(new Set(["thr_a"]));
    expect(store.getState().dragThreadId).toBe("thr_a");
    expect(store.getState().dropTarget).toEqual({
      kind: "reorder",
      threadId: "thr_b",
      placement: "before",
    });
  });

  it("keeps Work view state per thread but does not persist across a new store/remount", () => {
    const store = createThreadInteractionStore();
    store.getState().setWorkTab("thr_a", "changes");
    store.getState().setWorkTab("thr_b", "agents");
    expect(store.getState().workTabFor("thr_a")).toBe("changes");
    expect(store.getState().workTabFor("thr_b")).toBe("agents");
    expect(createThreadInteractionStore().getState().workTabFor("thr_a")).toBe("work");
  });

  it("cleans left-roster interaction entries while preserving right-panel tabs for archived threads", () => {
    const store = createThreadInteractionStore();
    for (let index = 0; index < 41; index += 1) store.getState().setWorkTab(`thr_${index}`, "changes");
    expect(store.getState().workTabFor("thr_0")).toBe("work");
    expect(store.getState().workTabFor("thr_1")).toBe("changes");
    store.getState().setSelected("thr_1", ["thr_1", "thr_2"]);
    store.getState().toggleChildren("thr_2");
    store.getState().setDrag("thr_2", {
      kind: "reorder",
      threadId: "thr_2",
      placement: "after",
    });
    store.getState().reconcileRoster(["thr_1"]);
    expect(store.getState().selectedThreadIds).toEqual(new Set(["thr_1"]));
    expect(store.getState().selectionAnchorId).toBe("thr_1");
    expect(store.getState().expandedThreadIds).toEqual(new Set());
    expect(store.getState().dragThreadId).toBeNull();
    expect(store.getState().dropTarget).toBeNull();
    expect(store.getState().workTabFor("thr_2")).toBe("changes");
  });

  it("refreshes recency on access so the second-oldest entry is evicted", () => {
    const store = createThreadInteractionStore();
    for (let index = 0; index < 40; index += 1) store.getState().setWorkTab(`thr_${index}`, "changes");
    store.getState().touchWorkTab("thr_0");
    store.getState().setWorkTab("thr_40", "agents");
    expect(store.getState().workTabFor("thr_0")).toBe("changes");
    expect(store.getState().workTabFor("thr_1")).toBe("work");
    expect(store.getState().workTabFor("thr_40")).toBe("agents");
  });

  it("mounts selector consumers so left selection/drag and right tabs stay scoped", () => {
    const store = createThreadInteractionStore();
    let threadATabRenders = 0;
    let threadBTabRenders = 0;
    const ThreadATab = memo(function ThreadATab() {
      threadATabRenders += 1;
      const tab = useStore(store, (state) => state.workTabsByThread.get("thr_a") ?? "work");
      return <button aria-label="set thread A changes" onClick={() => store.getState().setWorkTab("thr_a", "changes")}>{tab}</button>;
    });
    const ThreadBTab = memo(function ThreadBTab() {
      threadBTabRenders += 1;
      const tab = useStore(store, (state) => state.workTabsByThread.get("thr_b") ?? "work");
      return <output>{tab}</output>;
    });
    function Characterization() {
      const selected = useStore(store, (state) => state.selectedThreadIds.has("thr_a"));
      const dragging = useStore(store, (state) => state.dragThreadId === "thr_a");
      return <>
        <button onClick={() => store.getState().setSelected("thr_a", ["thr_a"])}>{selected ? "selected" : "idle"}</button>
        <button onClick={() => store.getState().setDrag("thr_a", { kind: "reorder", threadId: "thr_b", placement: "before" })}>{dragging ? "dragging" : "still"}</button>
        <ThreadATab />
        <ThreadBTab />
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
    expect(threadATabRenders).toBe(2);
    expect(threadBTabRenders).toBe(1);
  });
});

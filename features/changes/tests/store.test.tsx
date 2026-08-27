// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { useStore } from "zustand";
import { afterEach, describe, expect, it } from "vitest";
import { createChangesInteractionStore } from "../store";

afterEach(cleanup);

describe("R13 Changes presentation store", () => {
  it("keeps disclosure, stack expansion, and selected files isolated per thread", () => {
    const store = createChangesInteractionStore();

    store.getState().toggleRepository("thr_a");
    store.getState().toggleStackBranch("thr_a", "feature/a");
    store.getState().selectFile("thr_a", "a.ts");
    store.getState().togglePullRequest("thr_b");

    expect(store.getState().byThread.get("thr_a")).toMatchObject({
      repositoryExpanded: true,
      selectedFilePath: "a.ts",
    });
    expect(
      store
        .getState()
        .byThread.get("thr_a")
        ?.expandedStackBranches.has("feature/a"),
    ).toBe(true);
    expect(store.getState().byThread.get("thr_b")).toMatchObject({
      currentPullRequestExpanded: true,
      selectedFilePath: null,
    });
  });

  it("does not rerender a mounted thread selector when a sibling changes", () => {
    const store = createChangesInteractionStore();
    let rendersA = 0;
    let rendersB = 0;
    const Presentation = ({
      threadId,
      onRender,
    }: {
      threadId: string;
      onRender(): void;
    }) => {
      useStore(store, (state) => state.byThread.get(threadId));
      onRender();
      return null;
    };

    render(
      createElement(
        "div",
        null,
        createElement(Presentation, {
          threadId: "thr_a",
          onRender: () => {
            rendersA += 1;
          },
        }),
        createElement(Presentation, {
          threadId: "thr_b",
          onRender: () => {
            rendersB += 1;
          },
        }),
      ),
    );
    const initialB = rendersB;

    act(() => store.getState().toggleRepository("thr_a"));

    expect(rendersA).toBeGreaterThan(1);
    expect(rendersB).toBe(initialB);
  });

  it("keeps a touched oldest entry while enforcing the 40-thread LRU cap", () => {
    const store = createChangesInteractionStore();
    for (let index = 0; index < 40; index += 1)
      store.getState().selectFile(`thr_${index}`, `${index}.ts`);

    store.getState().toggleRepository("thr_0");
    store.getState().selectFile("thr_40", "40.ts");

    expect(store.getState().byThread).toHaveLength(40);
    expect(store.getState().byThread.has("thr_0")).toBe(true);
    expect(store.getState().byThread.has("thr_1")).toBe(false);
    expect(store.getState().byThread.has("thr_40")).toBe(true);
  });

  it("clears one thread's selected file without disturbing another thread", () => {
    const store = createChangesInteractionStore();
    store.getState().selectFile("thr_changes", "renamed.ts");
    store.getState().selectFile("thr_other", "other.ts");

    store.getState().selectFile("thr_changes", null);

    expect(
      store.getState().byThread.get("thr_changes")?.selectedFilePath,
    ).toBeNull();
    expect(store.getState().byThread.get("thr_other")?.selectedFilePath).toBe(
      "other.ts",
    );
  });
});

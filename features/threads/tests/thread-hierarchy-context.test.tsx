// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { configureAxe } from "vitest-axe";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useRef } from "react";

const evaluateCandidates = vi.hoisted(() => vi.fn());
const hierarchyRpc = vi.hoisted(() => ({ call: vi.fn() }));

vi.mock("../hierarchy-model", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../hierarchy-model")>();
  return {
    ...actual,
    createThreadHierarchyIndex: (...input: Parameters<typeof actual.createThreadHierarchyIndex>) => {
      const index = actual.createThreadHierarchyIndex(...input);
      return {
        ...index,
        candidates: (threadId: string) => {
          evaluateCandidates(threadId);
          return index.candidates(threadId);
        },
      };
    },
  };
});

vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@get-bb/plugin-sdk/app")>();
  return { ...actual, useRpc: () => hierarchyRpc };
});

import {
  ThreadHierarchyProvider,
  useThreadHierarchy,
} from "../thread-hierarchy-context";
import { ThreadHierarchyPickerHost } from "../thread-hierarchy-picker-host";

const axe = configureAxe({
  runOnly: { type: "tag", values: ["cat.aria", "cat.name-role-value"] },
});

function PickerInvoker() {
  const hierarchy = useThreadHierarchy();
  const buttonRef = useRef<HTMLButtonElement>(null);
  return (
    <button
      ref={buttonRef}
      type="button"
      onClick={(event) => {
        const { bottom, left, right, top } = event.currentTarget.getBoundingClientRect();
        hierarchy.openPicker({
          anchor: event.currentTarget,
          anchorRect: { bottom, left, right, top },
          onFocusReturn: () => buttonRef.current?.focus(),
          threadId: "thr_source",
          title: "Source",
        });
      }}
    >
      Move under
    </button>
  );
}

describe("Thread hierarchy picker lifecycle", () => {
  beforeEach(() => {
    evaluateCandidates.mockClear();
    hierarchyRpc.call.mockReset();
  });

  it("does no candidate work while closed, then renders one accessible shared-shell picker", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onRowPointerDown = vi.fn();
    const view = render(
      <QueryClientProvider client={client}>
        <ThreadHierarchyProvider
          ready
          taskLinks={{}}
          threads={[
            { id: "thr_source", projectId: "project", parentThreadId: null, isArchived: false, title: "Source" },
            { id: "thr_root", projectId: "project", parentThreadId: null, isArchived: false, title: "Root" },
            { id: "thr_child", projectId: "project", parentThreadId: "thr_root", isArchived: false, title: "Child" },
          ] as never}
        >
          <div onPointerDown={onRowPointerDown}>
            <PickerInvoker />
            <ThreadHierarchyPickerHost />
          </div>
        </ThreadHierarchyProvider>
      </QueryClientProvider>,
    );

    expect(evaluateCandidates).not.toHaveBeenCalled();
    fireEvent.click(view.getByRole("button", { name: "Move under" }));
    const picker = await view.findByRole("combobox", {
      name: "New parent for Source",
    });
    expect(evaluateCandidates).toHaveBeenCalledTimes(1);
    expect(document.querySelectorAll(".ws-hierarchy-combobox")).toHaveLength(1);
    expect(view.getByRole("option", { name: /^RootCurrent root/ }).textContent).toContain(
      "Current root: Root",
    );
    fireEvent.pointerDown(view.getByRole("option", { name: /^RootCurrent root/ }));
    expect(onRowPointerDown).not.toHaveBeenCalled();
    expect(await axe(document.body)).toHaveNoViolations();

    fireEvent.keyDown(picker, { key: "Escape" });
    await waitFor(() =>
      expect(document.activeElement).toBe(view.getByRole("button", { name: "Move under" })),
    );
    expect(evaluateCandidates).toHaveBeenCalledTimes(1);

    hierarchyRpc.call.mockRejectedValueOnce(new Error("Move is unavailable"));
    fireEvent.click(view.getByRole("button", { name: "Move under" }));
    const errorPicker = await view.findByRole("combobox", {
      name: "New parent for Source",
    });
    fireEvent.keyDown(errorPicker, { key: "ArrowDown" });
    fireEvent.keyDown(errorPicker, { key: "Enter" });
    expect((await view.findByRole("alert")).textContent).toContain(
      "Move is unavailable",
    );
    fireEvent.click(view.getByRole("button", { name: "Try again" }));
    expect(view.queryByRole("alert")).toBeNull();

    fireEvent.pointerDown(document.body);
    await waitFor(() =>
      expect(document.activeElement).toBe(view.getByRole("button", { name: "Move under" })),
    );
    expect(evaluateCandidates).toHaveBeenCalledTimes(2);

    let resolveMove!: (value: unknown) => void;
    hierarchyRpc.call.mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveMove = resolve;
      }),
    );
    fireEvent.click(view.getByRole("button", { name: "Move under" }));
    const reopenedPicker = await view.findByRole("combobox", {
      name: "New parent for Source",
    });
    fireEvent.keyDown(reopenedPicker, { key: "End" });
    fireEvent.keyDown(reopenedPicker, { key: "Enter" });
    expect((await view.findByRole("status")).textContent).toContain("Loading options");
    resolveMove({
      threadId: "thr_source",
      parentThreadId: "thr_child",
      oldRootThreadId: "thr_source",
      newRootThreadId: "thr_root",
      affectedThreadIds: ["thr_source"],
    });
    await waitFor(() =>
      expect(view.queryByRole("combobox", { name: "New parent for Source" })).toBeNull(),
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(view.getByRole("button", { name: "Move under" })),
    );
    expect(hierarchyRpc.call).toHaveBeenLastCalledWith("moveSidebarThread", {
      threadId: "thr_source",
      parentThreadId: "thr_child",
    });
    expect(evaluateCandidates).toHaveBeenCalledTimes(3);
    client.clear();
  });
});

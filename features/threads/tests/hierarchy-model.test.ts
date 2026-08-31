import { describe, expect, it } from "vitest";
import {
  evaluateThreadHierarchyMove,
  threadHierarchyCandidates,
  type HierarchyBinding,
  type HierarchyThread,
} from "../hierarchy-model";

const threads: HierarchyThread[] = [
  {
    id: "thr_root",
    projectId: "project_one",
    parentThreadId: null,
    isArchived: false,
    title: "Root",
  },
  {
    id: "thr_child",
    projectId: "project_one",
    parentThreadId: "thr_root",
    isArchived: false,
    title: "Child",
  },
  {
    id: "thr_nested",
    projectId: "project_one",
    parentThreadId: "thr_child",
    isArchived: false,
    title: "Nested",
  },
  {
    id: "thr_peer",
    projectId: "project_one",
    parentThreadId: "thr_root",
    isArchived: false,
    title: "Peer",
  },
  {
    id: "thr_other",
    projectId: "project_one",
    parentThreadId: null,
    isArchived: false,
    title: "Other",
  },
  {
    id: "thr_archived",
    projectId: "project_one",
    parentThreadId: null,
    isArchived: true,
    title: "Archived",
  },
  {
    id: "thr_foreign",
    projectId: "project_two",
    parentThreadId: null,
    isArchived: false,
    title: "Foreign",
  },
];

describe("thread hierarchy move rules", () => {
  it("accepts unbound promotion and reparenting while reporting the affected subtree", () => {
    expect(
      evaluateThreadHierarchyMove({
        threads,
        bindings: [],
        sourceThreadId: "thr_child",
        parentThreadId: null,
      }),
    ).toMatchObject({
      allowed: true,
      oldRootThreadId: "thr_root",
      newRootThreadId: "thr_child",
      affectedThreadIds: ["thr_child", "thr_nested"],
    });

    expect(
      evaluateThreadHierarchyMove({
        threads,
        bindings: [],
        sourceThreadId: "thr_other",
        parentThreadId: "thr_child",
      }),
    ).toMatchObject({
      allowed: true,
      oldRootThreadId: "thr_other",
      newRootThreadId: "thr_root",
      affectedThreadIds: ["thr_other"],
    });
  });

  it.each([
    ["thr_child", "thr_child", "same_thread"],
    ["thr_child", "thr_root", "same_parent"],
    ["thr_root", "thr_nested", "descendant_cycle"],
    ["thr_child", "thr_archived", "archived_thread"],
    ["thr_child", "thr_foreign", "cross_project"],
    ["thr_archived", null, "archived_thread"],
    ["thr_missing", null, "source_missing"],
    ["thr_child", "thr_missing", "parent_missing"],
  ] as const)(
    "rejects %s -> %s as %s",
    (sourceThreadId, parentThreadId, code) => {
      expect(
        evaluateThreadHierarchyMove({
          threads,
          bindings: [],
          sourceThreadId,
          parentThreadId,
        }),
      ).toMatchObject({ allowed: false, code });
    },
  );

  it("rejects only binding ownership whose root would change", () => {
    const bindings: HierarchyBinding[] = [
      {
        kind: "outcome",
        rootThreadId: "thr_root",
        ownerThreadId: "thr_root",
        taskKey: "BBPLUG-1",
      },
      {
        kind: "execution",
        rootThreadId: "thr_root",
        ownerThreadId: "thr_child",
        taskKey: "BBPLUG-2",
      },
    ];

    expect(
      evaluateThreadHierarchyMove({
        threads,
        bindings,
        sourceThreadId: "thr_child",
        parentThreadId: "thr_other",
      }),
    ).toMatchObject({
      allowed: false,
      code: "binding_root_change",
      bindingTaskKey: "BBPLUG-2",
    });
    expect(
      evaluateThreadHierarchyMove({
        threads,
        bindings,
        sourceThreadId: "thr_root",
        parentThreadId: "thr_other",
      }),
    ).toMatchObject({
      allowed: false,
      code: "binding_root_change",
      bindingTaskKey: "BBPLUG-1",
    });
    expect(
      evaluateThreadHierarchyMove({
        threads,
        bindings,
        sourceThreadId: "thr_nested",
        parentThreadId: "thr_root",
      }),
    ).toMatchObject({ allowed: true });
  });

  it("offers only active same-project non-descendant parents allowed by bindings", () => {
    const bindings: HierarchyBinding[] = [
      {
        kind: "execution",
        rootThreadId: "thr_root",
        ownerThreadId: "thr_child",
        taskKey: "BBPLUG-2",
      },
    ];

    expect(
      threadHierarchyCandidates(threads, bindings, "thr_child").map(
        (thread) => thread.id,
      ),
    ).toEqual(["thr_peer"]);
  });

  it("puts valid top-level parents first and distinguishes unloaded ancestry from a cycle", () => {
    expect(
      threadHierarchyCandidates(threads, [], "thr_child").map(
        (thread) => thread.id,
      ),
    ).toEqual(["thr_other", "thr_peer"]);

    expect(
      evaluateThreadHierarchyMove({
        threads: threads.filter((thread) => thread.id !== "thr_root"),
        bindings: [],
        sourceThreadId: "thr_child",
        parentThreadId: null,
      }),
    ).toMatchObject({ allowed: false, code: "hierarchy_not_fully_loaded" });

    expect(
      evaluateThreadHierarchyMove({
        threads: threads.map((thread) =>
          thread.id === "thr_root"
            ? { ...thread, parentThreadId: "thr_nested" }
            : thread,
        ),
        bindings: [],
        sourceThreadId: "thr_child",
        parentThreadId: null,
      }),
    ).toMatchObject({ allowed: false, code: "invalid_hierarchy" });
  });
});

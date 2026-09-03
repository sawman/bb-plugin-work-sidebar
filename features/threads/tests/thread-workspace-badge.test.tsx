// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ThreadWorkspaceBadge } from "../../../components/threads/thread-workspace-badge";

afterEach(cleanup);

describe("thread workspace metadata", () => {
  it("uses one proportional icon-bearing contract for every displayed location", () => {
    render(
      <>
        <ThreadWorkspaceBadge
          branchName={null}
          project={{ name: "Personal", isPersonal: true }}
          projectLabel="Personal"
        />
        <ThreadWorkspaceBadge
          branchName={null}
          workspaceDisplayKind="managed-worktree"
          project={{ name: "Work sidebar", isPersonal: false }}
          projectLabel="Work sidebar"
        />
        <ThreadWorkspaceBadge
          branchName={null}
          environmentName="R24 checkout"
          workspaceDisplayKind="managed-worktree"
          project={{ name: "Work sidebar", isPersonal: false }}
          projectLabel="Work sidebar"
        />
        <ThreadWorkspaceBadge
          branchName="bb/r24-location"
          environmentName="R24 checkout"
          workspaceDisplayKind="managed-worktree"
          project={{ name: "Work sidebar", isPersonal: false }}
          projectLabel="Work sidebar"
        />
      </>,
    );

    const locations = Array.from(
      document.querySelectorAll<HTMLElement>(".ws-thread-location"),
    );
    expect(locations).toHaveLength(4);
    expect(
      locations.map((location) => ({
        kind: location.dataset.locationKind,
        icon: location.querySelector("svg")?.dataset.icon,
        text: location.textContent,
      })),
    ).toEqual([
      { kind: "personal", icon: "Laptop", text: "Personal" },
      { kind: "worktree", icon: "Columns2", text: "Detached worktree" },
      { kind: "worktree", icon: "Columns2", text: "R24 checkout" },
      { kind: "branch", icon: "GitBranch", text: "bb/r24-location" },
    ]);

    const copyable = screen.getAllByRole("button");
    expect(copyable[0]?.dataset.typography).toBe("context");
    expect(copyable[1]?.classList).toContain("ws-branch-name");
    expect(copyable[1]?.dataset.typography).toBeUndefined();
    expect(
      locations.map((location) =>
        location.querySelector(".ws-thread-location-content"),
      ),
    ).toEqual([
      expect.any(HTMLElement),
      expect.any(HTMLElement),
      expect.any(HTMLElement),
      expect.any(HTMLElement),
    ]);
  });
});

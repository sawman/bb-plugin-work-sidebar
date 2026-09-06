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
          divergence={{ upstream: "origin/bb/r24-location", ahead: 12, behind: 3 }}
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
      { kind: "branch", icon: "GitBranch", text: "bb/r24-location↑12↓3" },
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
    expect(screen.getByRole("img", {
      name: "12 commits ahead and 3 commits behind origin/bb/r24-location",
    })).toBeTruthy();
    expect(document.querySelector(
      '[data-tooltip-label="12 ahead · 3 behind"]',
    )).toBeTruthy();
  });

  it("omits a divergence marker when the branch matches its remote", () => {
    render(
      <ThreadWorkspaceBadge
        branchName="main"
        projectLabel="Project"
        divergence={{ upstream: "origin/main", ahead: 0, behind: 0 }}
      />,
    );
    expect(document.querySelector(".ws-thread-branch-divergence")).toBeNull();
  });
});

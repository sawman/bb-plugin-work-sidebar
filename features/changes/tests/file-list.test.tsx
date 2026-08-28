// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChangedFilesList } from "../file-list";

afterEach(cleanup);

const files = [
  {
    path: "src/changed.ts",
    status: "modified" as const,
    additions: 12,
    deletions: 3,
  },
];

describe("shared Changes file list", () => {
  it("uses the PR row presentation for passive and interactive file lists", () => {
    const passive = render(<ChangedFilesList files={files} />);
    const passiveRow = screen.getByText("src/changed.ts").closest(".ws-change-file-row");
    expect(passiveRow?.tagName).toBe("SPAN");
    expect(screen.getByLabelText("12 lines added").textContent).toBe("+12");
    expect(screen.getByLabelText("3 lines deleted").textContent).toBe("−3");
    passive.unmount();

    const openFile = vi.fn();
    render(<ChangedFilesList files={files} onOpenFile={openFile} />);
    const interactiveRow = screen.getByRole("button", {
      name: "Open uncommitted diff for src/changed.ts",
    });
    expect(interactiveRow.classList.contains("ws-change-file-row")).toBe(true);
    fireEvent.click(interactiveRow);
    expect(openFile).toHaveBeenCalledWith("src/changed.ts");
  });
});

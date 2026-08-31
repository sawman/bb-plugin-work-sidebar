// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { SearchCombobox } from "../../components/ui/combobox";
import { TrackerSearch } from "../../features/tracker/views";

function PortalledPicker() {
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  return (
    <>
      <button ref={setAnchor} type="button">Move under</button>
      <SearchCombobox
        anchor={anchor}
        ariaLabel="New parent"
        emptyMessage="No parents"
        listboxLabel="Compatible parents"
        onOpenChange={() => undefined}
        onSelectionChange={() => undefined}
        open
        options={[{ value: "root", label: "Root" }]}
        placeholder="Search parents"
        portal
        selectedValues={[]}
      />
    </>
  );
}

describe("shared search shell behavior", () => {
  it("keeps server-driven tracker results, popup state, and focus under the user's control", () => {
    render(
      <>
        <button autoFocus type="button">Keep focus</button>
        <TrackerSearch
          busy={false}
          data={{ available: true, items: [], suggestions: [], message: null } as never}
          onChange={() => undefined}
          onLink={() => undefined}
          query="does-not-appear-in-the-server-result"
          search={{
            data: { items: [{ key: "LIN-42", title: "Fuzzy server match" }] },
            error: null,
            isError: false,
            isFetching: false,
            refetch: vi.fn(),
          } as never}
        />
      </>,
    );

    const input = screen.getByLabelText("Search Linear issues");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep focus" }));
    expect(document.querySelector("[data-portalled=true]")).toBeNull();

    fireEvent.focus(input);
    expect(screen.getByRole("option", { name: /LIN-42Fuzzy server match/ })).toBeTruthy();
  });

  it("keeps the input with its portalled picker and preserves combobox semantics when empty", () => {
    render(<PortalledPicker />);
    const input = screen.getByRole("combobox", { name: "New parent" });
    expect(input.closest("[data-portalled=true]")).toBeTruthy();

    const { rerender } = render(
      <SearchCombobox
        ariaLabel="Search tasks"
        emptyMessage="No tasks"
        listboxLabel="Tasks"
        onOpenChange={() => undefined}
        onSelectionChange={() => undefined}
        open
        options={[]}
        placeholder="Search tasks"
        selectedValues={[]}
      />,
    );
    const emptyInput = screen.getByRole("combobox", { name: "Search tasks" });
    expect(emptyInput.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByRole("status").textContent).toContain("No tasks");
    rerender(<></>);
  });
});

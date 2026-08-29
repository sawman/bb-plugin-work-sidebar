// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { configureAxe } from "vitest-axe";
import { SearchCombobox } from "./combobox";

const axe = configureAxe({
  runOnly: { type: "tag", values: ["cat.aria", "cat.name-role-value"] },
});

function MultiSelectFixture() {
  const [open, setOpen] = useState(true);
  const [selectedValues, setSelectedValues] = useState<string[]>(["alpha"]);
  const anchorRef = createRef<HTMLButtonElement>();
  return (
    <>
      <button ref={anchorRef} type="button">Open labels</button>
      <SearchCombobox
        anchorRef={anchorRef}
        ariaLabel="Search labels"
        emptyMessage="No labels"
        listboxLabel="Available labels"
        multiple
        onOpenChange={setOpen}
        onSelectionChange={setSelectedValues}
        open={open}
        options={[
          { value: "alpha", label: "Alpha" },
          { value: "beta", label: "Beta" },
          { value: "gamma", label: "Gamma" },
        ]}
        placeholder="Search labels…"
        portal
        selectedValues={selectedValues}
      />
      <output>{selectedValues.join(",")}</output>
    </>
  );
}

describe("SearchCombobox", () => {
  afterEach(cleanup);

  it("owns portal fit, valid combobox semantics, keyboard selection, dismissal, and focus restoration", async () => {
    render(<MultiSelectFixture />);
    const input = screen.getByRole("combobox", { name: "Search labels" });
    const listbox = screen.getByRole("listbox", { name: "Available labels" });

    expect(listbox.closest("[data-portalled=true]")).toBeTruthy();
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("option", { name: "Alpha" }).getAttribute("aria-selected")).toBe("true");

    fireEvent.keyDown(input, { key: "End" });
    expect(input.getAttribute("aria-activedescendant")).toBe(screen.getByRole("option", { name: "Gamma" }).id);
    fireEvent.keyDown(input, { key: "Home" });
    expect(input.getAttribute("aria-activedescendant")).toBe(screen.getByRole("option", { name: "Alpha" }).id);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input.getAttribute("aria-activedescendant")).toBe(screen.getByRole("option", { name: "Beta" }).id);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("alpha,beta")).toBeTruthy();

    const result = await axe(document.body);
    expect(result.violations).toEqual([]);
    expect(result.incomplete).toEqual([]);

    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Open labels" }));
  });

  it("renders busy, empty, and retryable error states without feature-owned popup markup", () => {
    const anchorRef = createRef<HTMLButtonElement>();
    const { rerender } = render(
      <>
        <button ref={anchorRef} type="button">Open tasks</button>
        <SearchCombobox
          anchorRef={anchorRef}
          ariaLabel="Search tasks"
          busy
          emptyMessage="No tasks"
          listboxLabel="Tasks"
          onOpenChange={() => undefined}
          onSelectionChange={() => undefined}
          open
          options={[]}
          placeholder="Search tasks…"
          selectedValues={[]}
        />
      </>,
    );
    expect(screen.getByRole("status").textContent).toContain("Loading");

    rerender(
      <>
        <button ref={anchorRef} type="button">Open tasks</button>
        <SearchCombobox
          anchorRef={anchorRef}
          ariaLabel="Search tasks"
          emptyMessage="No tasks"
          error={{ message: "Task source failed" }}
          listboxLabel="Tasks"
          onOpenChange={() => undefined}
          onRetry={() => undefined}
          onSelectionChange={() => undefined}
          open
          options={[]}
          placeholder="Search tasks…"
          selectedValues={[]}
        />
      </>,
    );
    expect(screen.getByRole("alert").textContent).toContain("Task source failed");
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});

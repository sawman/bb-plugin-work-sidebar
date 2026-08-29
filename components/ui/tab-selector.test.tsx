// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TabSelector } from "./tab-selector";

const items = [
  { id: "work", label: "Work", description: "Work details" },
  { id: "changes", label: "Changes", description: "Changed files" },
  { id: "agents", label: "Agents", description: "Running agents" },
] as const;

afterEach(cleanup);

function ControlledSelector({ tabs = false }: { tabs?: boolean }) {
  const [value, setValue] = useState<(typeof items)[number]["id"]>("work");
  return (
    <>
      <TabSelector
        ariaLabel="Views"
        controls={tabs ? (id) => `panel-${id}` : undefined}
        idPrefix="fixture"
        items={items}
        sticky={!tabs}
        value={value}
        onValueChange={setValue}
      />
      {tabs &&
        items.map(({ id }) => (
          <div
            key={id}
            id={`panel-${id}`}
            role="tabpanel"
            aria-labelledby={`fixture-tab-${id}`}
            hidden={value !== id}
          />
        ))}
    </>
  );
}

describe("TabSelector", () => {
  it("owns tab relationships and keyboard selection for the right selector", async () => {
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const view = render(<ControlledSelector tabs />);
    const work = view.getByRole("tab", { name: "Work" });
    fireEvent.keyDown(work, { key: "ArrowRight" });

    const changes = view.getByRole("tab", { name: "Changes" });
    await waitFor(() => expect(changes.getAttribute("aria-selected")).toBe("true"));
    expect(changes.getAttribute("aria-controls")).toBe("panel-changes");
    expect(document.activeElement).toBe(changes);
  });
});

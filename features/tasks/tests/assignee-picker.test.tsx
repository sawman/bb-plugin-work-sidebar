// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AssigneePicker } from "../assignee-picker";

describe("AssigneePicker", () => {
  afterEach(() => vi.useRealTimers());

  it("uses a two-second, cancelable swipe before changing responsibility", () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(
      <AssigneePicker value="human" taskKey="WORK-1" onChange={onChange} />,
    );
    const control = screen.getByRole("switch", {
      name: "Human assigned to WORK-1",
    });
    expect(screen.getByRole("tooltip").getAttribute("aria-label")).toBe(
      "Assign to Agent",
    );
    expect(control.getAttribute("data-assignee")).toBe("human");
    expect(control.textContent).toBe("");
    expect(control.querySelectorAll("svg")).toHaveLength(2);

    fireEvent.pointerDown(control, { clientX: 2, pointerId: 1 });
    fireEvent.pointerUp(control, { clientX: 30, pointerId: 1 });
    expect(
      screen.getByRole("switch", { name: /Agent assignment pending/ }),
    ).toBeTruthy();
    expect(screen.getByRole("tooltip").getAttribute("aria-label")).toBe(
      "Assigning to Agent",
    );
    expect(control.getAttribute("data-assignee")).toBe("agent");
    act(() => vi.advanceTimersByTime(1_999));
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.keyDown(control, { key: "Escape" });
    act(() => vi.advanceTimersByTime(5));
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.pointerDown(control, { clientX: 2, pointerId: 2 });
    fireEvent.pointerUp(control, { clientX: 30, pointerId: 2 });
    act(() => vi.advanceTimersByTime(2_000));
    expect(onChange).toHaveBeenCalledWith("agent");
  });
});

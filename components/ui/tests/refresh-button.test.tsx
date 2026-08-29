// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RefreshButton } from "../refresh-button";

afterEach(cleanup);

describe("shared refresh button", () => {
  it("spins its icon and keeps pointer feedback stable while refreshing", async () => {
    let resolve!: () => void;
    const refresh = vi.fn(
      () => new Promise<void>((next) => {
        resolve = next;
      }),
    );
    render(<RefreshButton label="Refresh test data" onRefresh={refresh} />);

    const button = screen.getByRole("button", { name: "Refresh test data" });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(refresh).toHaveBeenCalledOnce();
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.querySelector('[data-icon="RefreshCw"]')?.getAttribute("data-motion")).toBe("spin");

    resolve();
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
    expect(button.getAttribute("aria-busy")).toBeNull();
  });

  it("stays busy while its owner is still resolving a staged refresh", () => {
    const refresh = vi.fn();
    const { rerender } = render(
      <RefreshButton
        label="Refresh staged data"
        refreshing
        onRefresh={refresh}
      />,
    );

    const button = screen.getByRole("button", { name: "Refresh staged data" });
    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(
      button
        .querySelector('[data-icon="RefreshCw"]')
        ?.getAttribute("data-motion"),
    ).toBe("spin");
    fireEvent.click(button);
    expect(refresh).not.toHaveBeenCalled();

    rerender(
      <RefreshButton
        label="Refresh staged data"
        refreshing={false}
        onRefresh={refresh}
      />,
    );
    expect(button.getAttribute("aria-busy")).toBeNull();
    expect(button.hasAttribute("disabled")).toBe(false);
  });
});

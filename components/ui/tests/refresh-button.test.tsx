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
});

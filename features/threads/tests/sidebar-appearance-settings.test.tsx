// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getPluginQueryClient } from "../../../query-runtime";
import {
  normalizeSidebarRowHeight,
  validateSidebarRowHeight,
} from "../sidebar-appearance";

afterEach(() => {
  cleanup();
  getPluginQueryClient().clear();
});

describe("sidebar appearance settings", () => {
  it("validates 35px to 60px in tenth-pixel steps without clamping", () => {
    expect(validateSidebarRowHeight("35")).toEqual({ value: 35, error: null });
    expect(validateSidebarRowHeight("47.5")).toEqual({
      value: 47.5,
      error: null,
    });
    expect(validateSidebarRowHeight("47.1")).toEqual({
      value: 47.1,
      error: null,
    });
    expect(validateSidebarRowHeight("60")).toEqual({ value: 60, error: null });
    expect(validateSidebarRowHeight("34.9")).toMatchObject({ value: null });
    expect(validateSidebarRowHeight("60.5")).toMatchObject({ value: null });
    expect(validateSidebarRowHeight("47.25")).toEqual({
      value: null,
      error: "Enter a number with at most one decimal place.",
    });
    expect(normalizeSidebarRowHeight("invalid")).toBe(40);
  });

  it("highlights invalid input and automatically persists only an exact valid value", async () => {
    const save = vi.fn(({ rowHeight }: { rowHeight: number }) => ({
      rowHeight,
    }));
    const app = await loadPluginApp(() => import("../../../app"));
    const section = app.settingsSections.find(
      ({ id }) => id === "sidebar-appearance",
    )!;
    const slot = renderSlot(
      section,
      {},
      {
        rpc: {
          getSidebarAppearance: () => ({ rowHeight: 47 }),
          saveSidebarAppearance: save,
        } as never,
      },
    );
    const input = (await slot.findByRole("spinbutton", {
      name: "Row height",
    })) as HTMLInputElement;
    expect(
      input.closest(".ws-settings-card")?.getAttribute("data-layout"),
    ).toBe("narrow");
    expect(input.getAttribute("min")).toBe("35");
    expect(input.getAttribute("max")).toBe("60");
    expect(input.getAttribute("step")).toBe("0.1");

    fireEvent.change(input, { target: { value: "34.9" } });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(slot.getByRole("alert").textContent).toContain(
      "Enter a value from 35 to 60px.",
    );
    expect(save).not.toHaveBeenCalled();
    expect(slot.queryByRole("button", { name: /save/i })).toBeNull();
    expect(slot.queryByText(/default is/i)).toBeNull();

    fireEvent.change(input, { target: { value: "47.1" } });
    expect(input.hasAttribute("aria-invalid")).toBe(false);
    await waitFor(() => expect(save).toHaveBeenCalledWith({ rowHeight: 47.1 }));
  });
});

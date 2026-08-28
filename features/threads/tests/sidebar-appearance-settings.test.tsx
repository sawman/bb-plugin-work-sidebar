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
  it("validates 40px to 60px in tenth-pixel steps without clamping", () => {
    expect(validateSidebarRowHeight("40")).toEqual({ value: 40, error: null });
    expect(validateSidebarRowHeight("47.5")).toEqual({
      value: 47.5,
      error: null,
    });
    expect(validateSidebarRowHeight("47.1")).toEqual({
      value: 47.1,
      error: null,
    });
    expect(validateSidebarRowHeight("60")).toEqual({ value: 60, error: null });
    expect(validateSidebarRowHeight("39.5")).toMatchObject({ value: null });
    expect(validateSidebarRowHeight("60.5")).toMatchObject({ value: null });
    expect(validateSidebarRowHeight("47.25")).toEqual({
      value: null,
      error: "Enter a number with at most one decimal place.",
    });
    expect(normalizeSidebarRowHeight("invalid")).toBe(45);
  });

  it("highlights invalid input and persists only an exact valid value", async () => {
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
    const saveButton = slot.getByRole("button", {
      name: "Save",
    }) as HTMLButtonElement;
    expect(input.getAttribute("min")).toBe("40");
    expect(input.getAttribute("max")).toBe("60");
    expect(input.getAttribute("step")).toBe("0.1");

    fireEvent.change(input, { target: { value: "39.5" } });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(saveButton.disabled).toBe(true);
    expect(slot.getByRole("alert").textContent).toContain(
      "Enter a value from 40 to 60px.",
    );
    expect(save).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "47.1" } });
    expect(input.hasAttribute("aria-invalid")).toBe(false);
    expect(saveButton.disabled).toBe(false);
    fireEvent.click(saveButton);
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({ rowHeight: 47.1 }),
    );
    await waitFor(() => expect(saveButton.disabled).toBe(true));
  });
});

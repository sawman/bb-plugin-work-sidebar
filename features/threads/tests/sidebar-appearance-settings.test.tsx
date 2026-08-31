// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { configureAxe } from "vitest-axe";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getPluginQueryClient } from "../../../query-runtime";
import {
  DEFAULT_TEXT_SCALE,
  MAX_TEXT_SCALE,
  MIN_TEXT_SCALE,
  MINIMUM_TEXT_ROLE_SIZE_REM,
  MIN_ACCESSIBLE_TEXT_SIZE_PX,
  normalizeSidebarRowHeight,
  normalizeTextScale,
  validateTextScale,
  validateSidebarRowHeight,
} from "../sidebar-appearance";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const axe = configureAxe({
  runOnly: { type: "tag", values: ["cat.aria", "cat.name-role-value"] },
});

afterEach(() => {
  cleanup();
  getPluginQueryClient().clear();
  toast.success.mockReset();
  toast.error.mockReset();
});

describe("sidebar appearance settings", () => {
  it("validates the bounded compact/default/comfortable text scale", () => {
    expect(validateTextScale("0.9")).toEqual({ value: 0.9, error: null });
    expect(validateTextScale("1")).toEqual({ value: 1, error: null });
    expect(validateTextScale("1.10")).toEqual({ value: 1.1, error: null });
    expect(validateTextScale("0.89")).toMatchObject({ value: null });
    expect(validateTextScale("1.11")).toMatchObject({ value: null });
    expect(validateTextScale("1.001")).toEqual({
      value: null,
      error: "Enter a multiplier with at most two decimal places.",
    });
    expect(normalizeTextScale("invalid")).toBe(DEFAULT_TEXT_SCALE);
    expect(MIN_TEXT_SCALE * MINIMUM_TEXT_ROLE_SIZE_REM * 16).toBeGreaterThanOrEqual(
      MIN_ACCESSIBLE_TEXT_SIZE_PX,
    );
    expect(MAX_TEXT_SCALE).toBe(1.1);
  });

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

  it("shows inline text-scale errors, keeps invalid input local, and recovers after save failure", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("Text scale storage unavailable"))
      .mockResolvedValueOnce({ rowHeight: 47, textScale: 1.1 });
    const app = await loadPluginApp(() => import("../../../app"));
    const section = app.settingsSections.find(
      ({ id }) => id === "sidebar-appearance",
    )!;
    const slot = renderSlot(
      section,
      {},
      {
        rpc: {
          getSidebarAppearance: () => ({ rowHeight: 47, textScale: 1 }),
          saveSidebarAppearance: save,
        } as never,
      },
    );
    const input = (await slot.findByRole("spinbutton", {
      name: "Text scale",
    })) as HTMLInputElement;
    expect(input.closest(".ws-settings-card")?.getAttribute("data-layout")).toBe(
      "narrow",
    );
    expect(input.getAttribute("min")).toBe("0.9");
    expect(input.getAttribute("max")).toBe("1.1");
    expect(input.getAttribute("step")).toBe("0.01");

    fireEvent.change(input, { target: { value: "1.11" } });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(slot.getByRole("alert").textContent).toContain(
      "Enter a value from 0.9 to 1.1.",
    );
    expect(save).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "1.1" } });
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({ textScale: 1.1 }),
    );
    expect(toast.error).toHaveBeenCalledWith("Text scale storage unavailable");

    fireEvent.change(input, { target: { value: "1.09" } });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(toast.success).toHaveBeenCalledWith("Text scale set to 1.1");
    expect(input.getAttribute("aria-invalid")).toBeNull();
  });

  it("keeps the compact setting accessible", async () => {
    const app = await loadPluginApp(() => import("../../../app"));
    const section = app.settingsSections.find(
      ({ id }) => id === "sidebar-appearance",
    )!;
    const slot = renderSlot(
      section,
      {},
      {
        rpc: {
          getSidebarAppearance: () => ({ rowHeight: 47, textScale: 0.9 }),
        } as never,
      },
    );
    const input = (await slot.findByRole("spinbutton", {
      name: "Text scale",
    })) as HTMLInputElement;
    await waitFor(() => expect(input.value).toBe("0.9"));
    const results = await axe(slot.container);
    expect(results.violations).toEqual([]);
    expect(results.incomplete).toEqual([]);
  });

  it("offers and persists every working-provider animation", async () => {
    const save = vi.fn(async () => ({
      rowHeight: 40,
      textScale: 1,
      workingProviderAnimation: "fast-spin" as const,
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
          getSidebarAppearance: () => ({ rowHeight: 40, textScale: 1 }),
          saveSidebarAppearance: save,
        } as never,
      },
    );
    const style = await slot.findByRole("combobox", { name: "Style" });
    const speed = slot.getByRole("combobox", { name: "Speed" });
    expect((style as HTMLSelectElement).value).toBe("spin");
    expect((speed as HTMLSelectElement).value).toBe("slow");
    expect([...style.querySelectorAll("option")].map((option) => option.value)).toEqual([
      "none",
      "spin",
      "bounce",
      "sheen",
      "pulse",
    ]);
    fireEvent.change(style, { target: { value: "bounce" } });
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        workingProviderAnimation: "slow-bounce",
      }),
    );
  });
});

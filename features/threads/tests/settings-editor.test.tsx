// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NumericAutosaveEditor, type NumericSettingDescriptor } from "../settings-editor";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const textScale: NumericSettingDescriptor = {
  label: "Text scale",
  min: 0.9,
  max: 1.1,
  step: "0.01",
  suffix: "×",
  initialValue: 1,
  validate: (value) => {
    const parsed = Number(value);
    return parsed >= 0.9 && parsed <= 1.1 && /^\d+(?:\.\d{1,2})?$/.test(value)
      ? { value: parsed, error: null }
      : { value: null, error: "Enter a valid text scale." };
  },
  successMessage: (value) => `Text scale set to ${value}`,
};

afterEach(() => {
  cleanup();
  toast.success.mockReset();
  toast.error.mockReset();
});

describe("numeric settings editor lifecycle", () => {
  it("keeps validation local, waits for pending saves, and recovers a rejected draft", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("Settings unavailable"))
      .mockResolvedValueOnce(1.05);
    render(
      <NumericAutosaveEditor
        setting={textScale}
        saved={1}
        pending={false}
        onSave={save}
      />,
    );
    const input = screen.getByRole("spinbutton", { name: "Text scale" }) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "1.11" } });
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(save).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "1.05" } });
    await waitFor(() => expect(save).toHaveBeenCalledWith(1.05));
    expect(toast.error).toHaveBeenCalledWith("Settings unavailable");
    expect(input.value).toBe("1.05");
    fireEvent.change(input, { target: { value: "1.04" } });
    fireEvent.change(input, { target: { value: "1.05" } });
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(input.value).toBe("1.05");
    expect(toast.success).toHaveBeenCalledWith("Text scale set to 1.05");
  });

  it("does not autosave while the owning mutation is pending", async () => {
    const save = vi.fn().mockResolvedValue(1.05);
    const { rerender } = render(
      <NumericAutosaveEditor
        setting={textScale}
        saved={1}
        pending
        onSave={save}
      />,
    );
    const input = screen.getByRole("spinbutton", { name: "Text scale" }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "1.05" } });
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(save).not.toHaveBeenCalled();
    rerender(
      <NumericAutosaveEditor
        setting={textScale}
        saved={1}
        pending={false}
        onSave={save}
      />,
    );
    await waitFor(() => expect(save).toHaveBeenCalledWith(1.05));
  });

  it("adopts external saved values without stealing focus or overwriting a dirty draft", async () => {
    const save = vi.fn().mockResolvedValue(1.05);
    const { rerender } = render(
      <NumericAutosaveEditor
        setting={textScale}
        saved={1}
        pending={false}
        onSave={save}
      />,
    );
    const input = screen.getByRole("spinbutton", { name: "Text scale" }) as HTMLInputElement;
    input.focus();
    rerender(
      <NumericAutosaveEditor
        setting={textScale}
        saved={1.05}
        pending={false}
        onSave={save}
      />,
    );
    await waitFor(() => expect(input.value).toBe("1.05"));
    expect(document.activeElement).toBe(input);

    fireEvent.change(input, { target: { value: "1.02" } });
    rerender(
      <NumericAutosaveEditor
        setting={textScale}
        saved={0.98}
        pending={false}
        onSave={save}
      />,
    );
    expect(input.value).toBe("1.02");
  });
});

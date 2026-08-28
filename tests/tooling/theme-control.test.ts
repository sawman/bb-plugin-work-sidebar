import { runInNewContext } from "node:vm";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

const moduleUrl = pathToFileURL(resolve(process.cwd(), "scripts/bb-theme-control.mjs")).href;

async function loadThemeControl() {
  return await import(moduleUrl) as {
    buildRendererThemeScript: (theme: "light" | "dark" | "system" | null) => string;
    withTemporaryThemes: (
      controller: { readPreference: () => Promise<string | null>; setPreference: (theme: string | null) => Promise<void> },
      themes: readonly ("light" | "dark")[],
      run: (theme: "light" | "dark") => Promise<void>,
    ) => Promise<void>;
  };
}

describe("background BB theme control", () => {
  it("updates storage through BB's subscription event and resolves after repaint", async () => {
    const { buildRendererThemeScript } = await loadThemeControl();
    const values = new Map<string, string>([["bb.theme", "light"]]);
    const events: Array<{ key: string; oldValue: string | null; newValue: string | null }> = [];
    const root = { classList: { contains: (name: string) => name === "dark" && values.get("bb.theme") === "dark" } };
    const context = {
      document: { documentElement: root },
      location: { href: "http://127.0.0.1:38886/projects/example" },
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
      requestAnimationFrame: (callback: () => void) => callback(),
      StorageEvent: class {
        constructor(_type: string, readonly init: { key: string; oldValue: string | null; newValue: string | null }) {}
      },
      window: {
        dispatchEvent: (event: { init: { key: string; oldValue: string | null; newValue: string | null } }) => {
          events.push({
            key: event.init.key,
            oldValue: event.init.oldValue,
            newValue: event.init.newValue,
          });
        },
      },
    };

    const result = await runInNewContext(buildRendererThemeScript("dark"), context) as {
      preference: string | null;
      dark: boolean;
    };

    expect(result).toEqual({ preference: "dark", dark: true });
    expect(events).toEqual([{ key: "bb.theme", oldValue: "light", newValue: "dark" }]);
  });

  it("restores the exact original preference when a matrix command fails", async () => {
    const { withTemporaryThemes } = await loadThemeControl();
    const setPreference = vi.fn(async (_theme: string | null) => undefined);
    const controller = {
      readPreference: vi.fn(async () => "system"),
      setPreference,
    };

    await expect(withTemporaryThemes(controller, ["light", "dark"], async (theme) => {
      if (theme === "dark") throw new Error("capture failed");
    })).rejects.toThrow("capture failed");

    expect(setPreference.mock.calls).toEqual([["light"], ["dark"], ["system"]]);
  });

  it("restores a previously unset preference rather than forcing a mode", async () => {
    const { withTemporaryThemes } = await loadThemeControl();
    const setPreference = vi.fn(async (_theme: string | null) => undefined);

    await withTemporaryThemes({
      readPreference: async () => null,
      setPreference,
    }, ["dark"], async () => undefined);

    expect(setPreference.mock.calls).toEqual([["dark"], [null]]);
  });
});

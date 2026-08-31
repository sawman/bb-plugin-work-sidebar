import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const repositoryRoot = resolve(fileURLToPath(import.meta.url), "../../..");

describe("R1 app bundle ownership", () => {
  beforeAll(() => {
    execFileSync("npm", ["run", "build"], {
      cwd: repositoryRoot,
      env: { ...process.env, BB_CLI: undefined },
      stdio: "pipe",
    });
  });

  it("externalizes BB-owned React/SDK app runtime and bundles Query/Zustand", () => {
    const bundlePath = resolve(repositoryRoot, "dist/app.js");
    expect(existsSync(bundlePath), "the test-owned build must produce dist/app.js").toBe(true);
    const bundle = readFileSync(bundlePath, "utf8");

    expect(bundle).toContain("react/jsx-runtime");
    expect(bundle).toContain("@get-bb/plugin-sdk/app");
    expect(bundle).not.toMatch(/react(?:\.production|\.development)?\.min?\.js/);
    expect(bundle).not.toContain("REACT_ELEMENT_TYPE");
    expect(bundle).not.toContain("ReactCurrentDispatcher");
    expect(bundle).not.toContain("react-dom/client");
    // R2 replaces the temporary R1 reachability export with live module-
    // generation Query and Zustand seams used by registered slot providers.
    expect(bundle).toContain("work-sidebar");
    expect(bundle).toContain("setTimeoutProvider");
    // `getInitialState` is part of Zustand's vanilla StoreApi and is retained
    // by the minifier with its set/get/subscribe implementation. It is a
    // stronger ownership marker than application state literals alone.
    expect(bundle).toContain("getInitialState");
    expect(bundle).not.toContain("react-diff-view");
    const styles = readFileSync(resolve(repositoryRoot, "dist/app.css"), "utf8");
    expect(styles).not.toMatch(/ws-(review-diff|diff-toolbar|split-diff|working-tree-patch)/);
    expect(styles).toContain(
      ".ws-search-shell-options button[data-active=true]{background:var(--accent)}",
    );
    expect(styles).toContain(
      ".ws-search-shell-options button[data-active=true]{box-shadow:inset 0 0 0 1px var(--ring)}",
    );
  });

  it("retains the typed task automation RPC and tool markers in the server bundle", () => {
    const bundle = readFileSync(resolve(repositoryRoot, "dist/server.js"), "utf8");

    expect(bundle).toContain("createExecutionTask");
    expect(bundle).toContain("bindExecutionOwner");
    expect(bundle).toContain("create_work_task");
    expect(bundle).toContain("get_task");
    expect(bundle).toContain("update_task");
    expect(bundle).toContain("comment_task");
    expect(bundle).toContain("get_sidebar_tasks");
    expect(bundle).toContain("Pending/recovery dispatch states require explicit reconciliation");
  });
});

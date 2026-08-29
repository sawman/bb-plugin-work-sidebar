#!/usr/bin/env node

import { spawn, execFileSync } from "node:child_process";
import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const INSPECTOR_ORIGIN = "http://127.0.0.1:9229";
const THEME_KEY = "bb.theme";
const THEMES = new Set(["light", "dark", "system"]);

export function buildRendererThemeScript(theme) {
  if (theme !== null && !THEMES.has(theme)) throw new Error(`Unsupported theme: ${theme}`);
  const serializedTheme = JSON.stringify(theme);

  return `(() => {
    const key = ${JSON.stringify(THEME_KEY)};
    const next = ${serializedTheme};
    const previous = localStorage.getItem(key);
    if (next === null) localStorage.removeItem(key);
    else localStorage.setItem(key, next);
    window.dispatchEvent(new StorageEvent("storage", {
      key,
      oldValue: previous,
      newValue: next,
      storageArea: localStorage,
      url: location.href,
    }));
    return new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve({
          preference: localStorage.getItem(key),
          dark: document.documentElement.classList.contains("dark"),
        });
      };
      if (typeof setTimeout === "function") setTimeout(finish, 100);
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => requestAnimationFrame(finish));
      } else finish();
    });
  })()`;
}

function buildRendererReadScript() {
  return `(() => ({
    preference: localStorage.getItem(${JSON.stringify(THEME_KEY)}),
    dark: document.documentElement.classList.contains("dark"),
    title: document.title,
  }))()`;
}

export async function withTemporaryThemes(controller, themes, run) {
  const original = await controller.readPreference();
  let failure;

  try {
    for (const theme of themes) {
      await controller.setPreference(theme);
      await run(theme);
    }
  } catch (error) {
    failure = error;
  }

  try {
    await controller.setPreference(original);
  } catch (restoreError) {
    if (failure !== undefined) {
      throw new AggregateError([failure, restoreError], "Theme test failed and the original preference could not be restored");
    }
    throw restoreError;
  }

  if (failure !== undefined) throw failure;
}

function parsePid(value) {
  const pid = Number(value);
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error(`Invalid BB desktop PID: ${value}`);
  return pid;
}

function discoverBbDesktopPid() {
  const rows = execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
  const candidates = rows.split("\n").flatMap((row) => {
    const match = row.match(/^\s*(\d+)\s+(.+?)\s*$/u);
    if (!match || !/\/Contents\/MacOS\/bb$/u.test(match[2])) return [];
    return [Number(match[1])];
  });

  if (candidates.length !== 1) {
    throw new Error(`Expected one BB desktop process, found ${candidates.length}. Pass --pid <pid>.`);
  }
  return candidates[0];
}

async function fetchInspectorTarget() {
  try {
    const response = await fetch(`${INSPECTOR_ORIGIN}/json/list`, { signal: AbortSignal.timeout(250) });
    if (!response.ok) return null;
    const targets = await response.json();
    return targets.find((target) => typeof target.webSocketDebuggerUrl === "string") ?? null;
  } catch {
    return null;
  }
}

class InspectorClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 0;
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    return new InspectorClient(socket);
  }

  async call(method, params = {}) {
    const id = ++this.nextId;
    return await new Promise((resolve, reject) => {
      const onMessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.id !== id) return;
        this.socket.removeEventListener("message", onMessage);
        if (message.error) reject(new Error(`${method} failed: ${JSON.stringify(message.error)}`));
        else resolve(message.result);
      };
      this.socket.addEventListener("message", onMessage);
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.call("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (response.exceptionDetails) {
      const detail = response.exceptionDetails.exception?.description ?? response.exceptionDetails.text;
      throw new Error(`Electron evaluation failed: ${detail}`);
    }
    return response.result?.value;
  }

  close() {
    this.socket.close();
  }
}

async function openInspector(pid) {
  let target = await fetchInspectorTarget();
  let opened = false;
  if (target === null) {
    process.kill(pid, "SIGUSR1");
    opened = true;
    for (let attempt = 0; attempt < 20 && target === null; attempt += 1) {
      await delay(50);
      target = await fetchInspectorTarget();
    }
  }
  if (target === null) throw new Error("BB's Electron inspector did not become available on 127.0.0.1:9229");

  const client = await InspectorClient.connect(target.webSocketDebuggerUrl);
  const inspectedPid = await client.evaluate("process.pid");
  if (inspectedPid !== pid) {
    client.close();
    throw new Error(`Port 9229 belongs to process ${inspectedPid}, not BB desktop process ${pid}`);
  }
  return { client, opened };
}

function rendererEvaluationExpression(rendererScript) {
  return `(async () => {
    const { BrowserWindow } = process.mainModule.require("electron");
    const windows = BrowserWindow.getAllWindows().filter((window) => {
      if (window.isDestroyed() || window.webContents.isDestroyed()) return false;
      return /^https?:\\/\\//u.test(window.webContents.getURL());
    });
    if (windows.length === 0) throw new Error("No live BB renderer window was found");
    return await Promise.all(windows.map((window) => window.webContents.executeJavaScript(${JSON.stringify(rendererScript)})));
  })()`;
}

async function closeInspector(session) {
  if (!session.opened) {
    session.client.close();
    return;
  }
  try {
    session.client.socket.send(JSON.stringify({
      id: ++session.client.nextId,
      method: "Runtime.evaluate",
      params: { expression: `process.mainModule.require("inspector").close()` },
    }));
    await delay(75);
  } finally {
    session.client.close();
  }
}

async function createThemeController(pid) {
  const session = await openInspector(pid);
  const evaluateRenderers = (script) => session.client.evaluate(rendererEvaluationExpression(script));

  return {
    session,
    controller: {
      async readPreference() {
        const results = await evaluateRenderers(buildRendererReadScript());
        const preferences = new Set(results.map((result) => result.preference));
        if (preferences.size !== 1) throw new Error("Open BB windows disagree about the current theme preference");
        return results[0].preference;
      },
      async probe() {
        return await evaluateRenderers(buildRendererReadScript());
      },
      async setPreference(theme) {
        const results = await evaluateRenderers(buildRendererThemeScript(theme));
        for (const result of results) {
          if (result.preference !== theme) throw new Error(`BB persisted ${result.preference} instead of ${theme}`);
          if (theme === "light" && result.dark) throw new Error("BB remained dark after applying the light preference");
          if (theme === "dark" && !result.dark) throw new Error("BB remained light after applying the dark preference");
        }
      },
    },
  };
}

function runCommand(command, args, theme) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      env: { ...process.env, BB_TEST_THEME: theme },
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed in ${theme} mode (${signal ?? `exit ${code}`})`));
    });
  });
}

function usage() {
  return `Usage:
  npm run theme-control -- probe [--pid <pid>]
  npm run theme-control -- with <light|dark> -- <command> [args...]
  npm run theme-control -- matrix -- <command> [args...]

The command receives BB_TEST_THEME=light or dark. The original bb.theme value is
restored even when the command fails. BB is never focused and Settings is never opened.`;
}

async function main(argv) {
  const args = [...argv];
  const pidIndex = args.indexOf("--pid");
  const pid = pidIndex === -1
    ? discoverBbDesktopPid()
    : parsePid(args.splice(pidIndex, 2)[1]);
  const commandName = args.shift();
  const { session, controller } = await createThemeController(pid);

  try {
    if (commandName === "probe") {
      console.log(JSON.stringify(await controller.probe(), null, 2));
      return;
    }

    const separator = args.indexOf("--");
    if (separator === -1 || separator === args.length - 1) throw new Error(usage());
    const command = args[separator + 1];
    const commandArgs = args.slice(separator + 2);

    if (commandName === "with") {
      const theme = args[0];
      if (theme !== "light" && theme !== "dark") throw new Error(usage());
      await withTemporaryThemes(controller, [theme], (activeTheme) => runCommand(command, commandArgs, activeTheme));
      return;
    }
    if (commandName === "matrix") {
      await withTemporaryThemes(controller, ["light", "dark"], (activeTheme) => runCommand(command, commandArgs, activeTheme));
      return;
    }
    throw new Error(usage());
  } finally {
    await closeInspector(session);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

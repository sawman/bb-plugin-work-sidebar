// @vitest-environment jsdom
import { createElement, useEffect, type FunctionComponent } from "react";
import { act, cleanup, fireEvent, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configureAxe } from "vitest-axe";
import type { MarkdownProps, PluginSdkApp } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot, type RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import type { rpcContract } from "../../../contracts";
import { getPluginQueryClient } from "../../../query-runtime";
import type { HumanMessage } from "../schemas";

type Rpc = NonNullable<RenderSlotOptions<typeof rpcContract>["rpc"]>;
// jsdom cannot measure host contrast/layout. Keep the plugin accessibility gate
// on semantic controls; native diagram accessibility remains live acceptance.
const axe = configureAxe({ runOnly: { type: "tag", values: ["cat.aria", "cat.name-role-value"] } });
const message: HumanMessage = {
  id: "msg_diagram", threadId: "thr_inbox", projectId: "proj_inbox",
  subject: "Diagram handoff", body: "", agentThreadId: "thr_agent",
  providerId: "codex", agentLabel: "Codex", revision: 1,
  createdAt: "2026-10-30T00:00:00.000Z", updatedAt: "2026-10-30T00:00:00.000Z",
  acknowledgedAt: null, bookmarkedAt: null,
};

async function mount(body: string, configureHost?: (host: PluginSdkApp) => void) {
  const app = await loadPluginApp(() => import("../../../app"));
  const runtime = globalThis as unknown as { __bbPluginRuntime: { pluginSdkApp: PluginSdkApp } };
  configureHost?.(runtime.__bbPluginRuntime.pluginSdkApp);
  let currentBody = body;
  // The SDK harness projects the registered thread tab to this typed alias.
  const slot = renderSlot(app.threadPanelActions.find((tab) => tab.id === "work-context")!, {
    threadId: message.threadId, params: null,
  }, {
    rpc: {
      sidebarTasks: () => ({ available: true, tasks: [], projects: [], error: null }),
      sidebarTaskLinks: () => ({ available: true, links: {}, error: null }),
      getWorkStatus: () => ({ rootThreadId: message.threadId, currentThread: { title: "Inbox", status: "idle", runtimeStatus: "idle", providerId: "codex" }, children: [] }),
      getLatestActivity: () => ({ currentThread: { status: "idle", runtimeStatus: "idle" }, latest: null, lastUser: null, current: null }),
      getWorkOutcome: () => ({ rootThreadId: message.threadId, tasksAvailable: true, outcome: null, executionTasks: [], bindings: [], legacy: { state: "none", taskIds: [], message: null } }),
      getWorkGoal: () => null,
      getWorkPlan: () => ({ items: [] }),
      getWorkProviderStatus: () => ({ tone: "green", providerId: "codex", providerName: "Codex", statusUrl: null, status: "ready", message: null }),
      getWorkTracker: () => ({ visible: false, available: false, message: null, suggestions: [], items: [] }),
      getWorkBackgroundJobs: () => ({ items: [] }),
      listHumanMessages: () => ({ messages: [{ ...message, body: currentBody }, { ...message, id: "msg_other", subject: "Other message", body: "Other **Markdown**" }], cursor: null, activeCount: 2, savedCount: 0, historyCount: 0 }),
    } as unknown as Rpc,
    sdk: { threads: { storagePaths: async () => ({ paths: [], truncated: false, storageRootPath: "/unused" }) } },
  });
  const title = await slot.findByRole("button", { name: `Copy message ID ${message.id}` });
  const row = title.closest("li")!;
  fireEvent.click(within(row).getByRole("button", { name: "Expand message body" }));
  const updateBody = async (next: string) => {
    currentBody = next;
    await act(async () => { await getPluginQueryClient().refetchQueries(); });
  };
  return { slot, row, updateBody };
}

afterEach(() => { cleanup(); getPluginQueryClient().clear(); vi.restoreAllMocks(); });

function HostEffectFailure() {
  useEffect(() => { throw new Error("Host diagram effect failed"); }, []);
  return <span>Pending host diagram</span>;
}

describe("registered Work Inbox Markdown host boundary", () => {
  it("passes a complete Mermaid fence with its document context to host Markdown", async () => {
    const body = "Before 😀\n\n```mermaid\nflowchart TD\n A-->B\n```\n\nAfter **diagram**";
    const { row } = await mount(body);
    // SDK harness Markdown deliberately echoes source; this proves the actual
    // registered Inbox delegates to the host API, not native SVG rendering.
    const host = within(row).getByTestId("bb-markdown");
    expect(host.textContent).toBe(body);
    expect(within(row).queryByLabelText("Mermaid diagram source")).toBeNull();
  });

  it.each([
    ["ordinary code", "Before\n```js\nconst html = '<script>literal</script>';\n```\nAfter"],
    ["enclosing backticks", "````markdown\n```mermaid\nA-->B\n```\n````"],
    ["enclosing tildes", "~~~~text\n```mermaid\nA-->B\n```\n~~~~"],
    ["incomplete enclosing fence", "````text\n```mermaid\nA-->B"],
    ["several diagrams and code", "```mermaid\nflowchart TD\nA-->B\n```\n\n```ts\nconst n = 1;\n```\n\n~~~mermaid\nsequenceDiagram\nA->>B: Hello\n~~~"],
    ["CRLF and whitespace", "Before\r\n   ````mermaid  \r\nflowchart LR\r\n A-->B\r\n   `````\r\nAfter"],
    ["CR lines", "```js\rcode\r```\r```mermaid\rflowchart TD\rA-->B\r```"],
    ["host parse error", "Before\n```mermaid\nthis is not a diagram\n<script>literal</script>\n```\nAfter"],
    ["HTML document context", "<details>\n<summary>Diagram</summary>\n\n```mermaid\nflowchart TD\nA-->B\n```\n</details>"],
  ])("preserves %s as one original host Markdown document", async (_label, body) => {
    const { row } = await mount(body);
    expect(within(row).getByTestId("bb-markdown").textContent).toBe(body);
    expect(within(row).queryByLabelText("Inbox message source")).toBeNull();
  });

  it.each([
    ["unclosed Mermaid", "Before\n```mermaid\nflowchart TD\nA-->B"],
    ["short closing fence", "````mermaid\nflowchart TD\nA-->B\n```"],
    ["wrong closing marker", "~~~mermaid\nflowchart TD\nA-->B\n```"],
    ["closing info text", "```mermaid\nflowchart TD\nA-->B\n```still-open"],
    ["unsupported info", "Before\n```mermaid dark\nA-->B\n```\nAfter"],
    ["blockquote", "> ```mermaid\n> flowchart TD\n> A-->B\n> ```"],
    ["list container", "- Diagram:\n\n    ```mermaid\n    flowchart TD\n    A-->B\n    ```"],
    ["encoded info", "```merm&#97;id\nflowchart TD\nA-->B"],
    ["escaped info", "```merm\\aid\nflowchart TD\nA-->B"],
    ["nested encoded info", "> ```merm&#97;id\n> flowchart TD\n> A-->B"],
    ["combined containers", "- > 1. ```mermaid\n  >    flowchart TD\n  >    A-->B"],
  ])("keeps %s as selectable original source without calling host Markdown", async (_label, body) => {
    const { row } = await mount(body);
    expect(within(row).queryByTestId("bb-markdown")).toBeNull();
    const source = within(row).getByLabelText("Inbox message source");
    expect(source.textContent).toBe(body);
    const selection = window.getSelection()!;
    const range = document.createRange();
    range.selectNodeContents(source);
    selection.removeAllRanges();
    selection.addRange(range);
    expect(selection.toString()).toBe(body);
    selection.removeAllRanges();
    expect(source.querySelector("script, img, svg, iframe")).toBeNull();
  });

  it("switches incomplete source to host Markdown when a message edit completes the fence", async () => {
    const incomplete = "Before\n```mermaid\nflowchart TD\nA-->B";
    const { row, updateBody } = await mount(incomplete);
    expect(within(row).getByLabelText("Inbox message source").textContent).toBe(incomplete);
    const complete = `${incomplete}\n\`\`\`\nAfter`;
    await updateBody(complete);
    expect(within(row).getByTestId("bb-markdown").textContent).toBe(complete);
    expect(within(row).queryByLabelText("Inbox message source")).toBeNull();
    await updateBody(incomplete);
    expect(within(row).getByLabelText("Inbox message source").textContent).toBe(incomplete);
  });

  it("keeps the host mounted across complete source edits so native streaming recovery and copy remain host-owned", async () => {
    const body = "```mermaid\nflowchart TD\nA-->B\n```";
    const mounted = vi.fn();
    const unmounted = vi.fn();
    const { row, updateBody } = await mount(body, (host) => {
      const markdownHost = host as { Markdown: FunctionComponent<MarkdownProps> };
      const original = markdownHost.Markdown;
      function TrackedHostMarkdown(props: MarkdownProps) {
        useEffect(() => { mounted(); return () => { unmounted(); }; }, []);
        return createElement(original, props);
      }
      vi.spyOn(markdownHost, "Markdown").mockImplementation(TrackedHostMarkdown);
    });
    expect(mounted).toHaveBeenCalledOnce();
    const malformedEdit = "```mermaid\nflowchart TD\nA[\n```";
    await updateBody(malformedEdit);
    expect(within(row).getByTestId("bb-markdown").textContent).toBe(malformedEdit);
    expect(mounted).toHaveBeenCalledOnce();
    expect(unmounted).not.toHaveBeenCalled();
    await updateBody(body);
    expect(within(row).getByTestId("bb-markdown").textContent).toBe(body);
    expect(mounted).toHaveBeenCalledOnce();
    expect(unmounted).not.toHaveBeenCalled();
  });

  it.each(["render", "effect"])("contains an unexpected host %s error to the message and retries after an edit", async (phase) => {
    const body = "Before\n```mermaid\nflowchart TD\nA-->B\n```\nAfter";
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { row, slot, updateBody } = await mount(body, (host) => {
      // TestMarkdown is a function in the installed SDK harness (native host
      // Markdown is a ComponentType). Override only this host boundary.
      const markdownHost = host as { Markdown: FunctionComponent<MarkdownProps> };
      const original = markdownHost.Markdown;
      vi.spyOn(markdownHost, "Markdown").mockImplementation((props) => {
        if (props.content !== body) return createElement(original, props);
        if (phase === "render") throw new Error("Host diagram render failed");
        return <HostEffectFailure />;
      });
    });
    expect(within(row).getByLabelText("Inbox message source").textContent).toBe(body);
    expect(within(row).getByRole("button", { name: `Bookmark message ${message.id}` })).toBeTruthy();
    const other = slot.getByRole("button", { name: "Copy message ID msg_other" }).closest("li")!;
    fireEvent.click(within(other).getByRole("button", { name: "Expand message body" }));
    expect(within(other).getByTestId("bb-markdown").textContent).toBe("Other **Markdown**");
    const edited = `${body}\nEdited`;
    await updateBody(edited);
    expect(within(row).getByTestId("bb-markdown").textContent).toBe(edited);
    expect(within(row).queryByLabelText("Inbox message source")).toBeNull();
  });

  it("retains long source and accessible disclosures at a narrow container width", async () => {
    const body = `Before 😀\n\`\`\`mermaid\nflowchart LR\nA[${"long label ".repeat(1200)}]-->B\n\`\`\`\nAfter`;
    const { row, updateBody } = await mount(body);
    (row as HTMLElement).style.width = "220px";
    expect(within(row).getByTestId("bb-markdown").textContent).toBe(body);
    expect(await axe(row)).toHaveNoViolations();
    const incomplete = `${body}\n\`\`\`mermaid\n<script>alert('literal')</script>`;
    await updateBody(incomplete);
    expect(within(row).getByLabelText("Inbox message source").textContent).toBe(incomplete);
    expect(row.querySelector("script")).toBeNull();
    expect(await axe(row)).toHaveNoViolations();
    const toggle = within(row).getByRole("button", { name: "Collapse message body" });
    toggle.focus();
    expect(document.activeElement).toBe(toggle);
    fireEvent.click(toggle);
    expect(within(row).queryByLabelText("Inbox message source")).toBeNull();
    expect(within(row).getByRole("button", { name: "Expand message body" }).getAttribute("aria-expanded")).toBe("false");
  });
});

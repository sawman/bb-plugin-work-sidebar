// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configureAxe } from "vitest-axe";
import { formatMessageAge, InboxCard, InboxMessageContent } from "../views";
import type { HumanMessage } from "../schemas";

const axe = configureAxe({
  runOnly: { type: "tag", values: ["cat.aria", "cat.name-role-value"] },
});

const { rpcClient, markdown, writeText } = vi.hoisted(() => ({
  rpcClient: { call: vi.fn() },
  markdown: vi.fn(({ content }: { content: string }) => content.startsWith("# Rich Inbox fixture") ? (
    <div data-testid="markdown">
      <h2>Compact heading</h2>
      <p>Paragraph with <strong>emphasis</strong> and <code>inlineCode()</code>.</p>
      <ul><li>List item</li></ul>
      <blockquote>Quoted detail</blockquote>
      <table><tbody><tr><th>Key</th><td>Value</td></tr></tbody></table>
      <pre><code>longLine()</code></pre>
      <img alt="Attached diagram" src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" />
    </div>
  ) : <div data-testid="markdown">{content}</div>),
  writeText: vi.fn().mockResolvedValue(undefined),
}));

Object.defineProperty(navigator, "clipboard", {
  configurable: true,
  value: { writeText },
});

vi.mock("@get-bb/plugin-sdk/app", () => ({
  useRpc: () => rpcClient,
  useRealtime: () => undefined,
  Markdown: markdown,
}));

const active: HumanMessage = {
  id: "msg_active",
  threadId: "thr_one",
  projectId: "proj_one",
  subject: "Active answer",
  body: "**Markdown** and 😀",
  agentThreadId: "thr_agent",
  providerId: "codex",
  agentLabel: "Codex",
  createdAt: "2026-09-06T00:00:00.000Z",
  updatedAt: "2026-09-06T00:00:00.000Z",
  acknowledgedAt: null,
  bookmarkedAt: null,
  revision: 1,
};
const saved = { ...active, id: "msg_saved", subject: "Saved answer", acknowledgedAt: "2026-09-06T00:01:00.000Z", bookmarkedAt: "2026-09-06T00:02:00.000Z", revision: 2 };
const history = { ...active, id: "msg_history", subject: "Old handoff", body: "history body", acknowledgedAt: "2026-09-06T00:03:00.000Z", revision: 2 };

function renderCard(
  messages = [active, saved],
  options: { query?: string; activeCount?: number; savedCount?: number; historyCount?: number } = {},
) {
  rpcClient.call.mockImplementation(async (method: string, input: { query?: string }) => {
    if (method === "listHumanMessages" && input.query) return { messages: [history], cursor: null, activeCount: 1, savedCount: 1, historyCount: 1 };
    return {
      messages,
      cursor: null,
      activeCount: options.activeCount ?? 4,
      savedCount: options.savedCount ?? 7,
      historyCount: options.historyCount ?? 3,
    };
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <InboxCard threadId="thr_one" />
    </QueryClientProvider>,
  );
  return { ...view, client };
}

async function findMessageRow(view: { container: HTMLElement }, messageId: string) {
  let row: HTMLElement | null = null;
  await waitFor(() => {
    row = view.container.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
    expect(row).toBeTruthy();
  });
  return row!;
}

afterEach(() => {
  cleanup();
  rpcClient.call.mockReset();
  writeText.mockClear();
  vi.clearAllMocks();
});

describe("Inbox Work card", () => {
  it("keeps rich Markdown descendants inside the compact message boundary", () => {
    const view = render(<InboxMessageContent content="# Rich Inbox fixture\n\n- List item" />);
    const boundary = view.container.querySelector<HTMLElement>(".ws-inbox-message-content")!;

    expect(within(boundary).getByRole("heading", { name: "Compact heading" })).toBeTruthy();
    expect(within(boundary).getByRole("list")).toBeTruthy();
    expect(within(boundary).getByRole("blockquote")).toBeTruthy();
    expect(within(boundary).getByRole("table")).toBeTruthy();
    expect(within(boundary).getByRole("img", { name: "Attached diagram" })).toBeTruthy();
  });

  it("renders shared Messages/Saved/History groups with History collapsed", async () => {
    const view = renderCard([active, saved, history], { historyCount: 1 });
    expect(await view.findByRole("heading", { name: "Inbox" })).toBeTruthy();
    await findMessageRow(view, "msg_active");
    expect(view.getByRole("button", { name: /^Messages:/ })).toBeTruthy();
    expect(view.getByRole("button", { name: /^Saved:/ })).toBeTruthy();
    const historyGroup = view.getByRole("button", { name: /^History:/ });
    expect(view.getByRole("button", { name: /^Messages:/ }).textContent).toContain("4");
    expect(view.getByRole("button", { name: /^Saved:/ }).textContent).toContain("7");
    expect(historyGroup.textContent).toContain("1");
    expect(historyGroup.getAttribute("aria-expanded")).toBe("false");
    expect(view.queryByRole("searchbox", { name: "Search Inbox messages" })).toBeNull();
    expect(view.getByRole("button", { name: "Search Inbox" }).getAttribute("aria-expanded")).toBe("false");
    expect(view.container.querySelector('[data-message-id="msg_active"]')).toBeTruthy();
    expect(view.container.querySelector('[data-message-id="msg_saved"]')).toBeTruthy();
    expect(view.container.querySelector('[data-message-id="msg_history"]')).toBeNull();
    fireEvent.click(historyGroup);
    expect(view.container.querySelector('[data-message-id="msg_history"]')).toBeTruthy();
    expect(view.queryByText("**Markdown** and 😀")).toBeNull();
    expect(view.queryByRole("button", { name: /delete/i })).toBeNull();
    view.unmount();
    view.client.clear();
  });

  it("compacts a message into one subject, relative time, and icon-actions row", async () => {
    const view = renderCard([active]);
    const row = (await view.findByText("Active answer")).closest("li")!;
    const heading = row.querySelector(".ws-inbox-message-heading")!;
    const copy = within(row).getByRole("button", { name: "Copy message ID msg_active" });
    const bookmark = within(row).getByRole("button", { name: "Bookmark message msg_active" });
    const time = within(row).getByText(/^(?:now|[0-9]+[mhd])$/);

    expect(heading.contains(time)).toBe(true);
    expect(heading.contains(copy)).toBe(true);
    expect(copy.textContent).toBe("Active answer");
    expect(copy.querySelector("svg")).toBeNull();
    expect(row.textContent).not.toContain("Codex");
    expect(row.textContent).not.toContain("Created");
    expect(row.textContent).not.toContain("msg_active");
    expect(bookmark.querySelector('[data-icon="Bookmark"] path')).toBeTruthy();
    expect(bookmark.querySelector('[data-icon="Bookmark"] circle')).toBeNull();
    expect(formatMessageAge("2026-09-10T00:00:00.000Z", Date.parse("2026-09-10T05:00:00.000Z"))).toBe("5h");
    fireEvent.click(copy);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("msg_active"));

    view.unmount();
    view.client.clear();
  });

  it("starts each message body collapsed and toggles it with the compact icon action", async () => {
    const view = renderCard([active]);
    const row = await findMessageRow(view, "msg_active");
    const expand = within(row).getByRole("button", { name: "Expand message body" });
    const bodyId = expand.getAttribute("aria-controls");

    expect(expand.closest(".ws-inbox-message-actions")).toBeTruthy();
    expect(expand.getAttribute("aria-expanded")).toBe("false");
    expect(expand.querySelector('[data-icon="ChevronDown"]')).toBeTruthy();
    expect(expand.textContent).toBe("");
    expect(bodyId).toBeTruthy();
    expect(row.querySelector(`[id="${bodyId}"]`)).toBeNull();

    fireEvent.click(expand);
    const collapse = within(row).getByRole("button", { name: "Collapse message body" });
    expect(collapse.querySelector('[data-icon="ChevronUp"]')).toBeTruthy();
    expect(row.querySelector(`[id="${bodyId}"]`)).toBeTruthy();

    fireEvent.click(collapse);
    expect(within(row).getByRole("button", { name: "Expand message body" })).toBeTruthy();
    expect(row.querySelector(`[id="${bodyId}"]`)).toBeNull();
    view.unmount();
    view.client.clear();
  });

  it("uses the zero group counts as the complete empty state", async () => {
    const view = renderCard([], { activeCount: 0, savedCount: 0, historyCount: 0 });
    const messages = await view.findByRole("button", { name: "Messages: 0 messages" });
    const saved = view.getByRole("button", { name: "Saved: 0 messages" });
    const historyGroup = view.getByRole("button", { name: "History: 0 messages" });

    expect(messages.textContent).toContain("0");
    expect(saved.textContent).toContain("0");
    expect(historyGroup.textContent).toContain("0");
    expect(view.queryByText("No unread messages")).toBeNull();
    expect(view.queryByText("No saved messages")).toBeNull();
    view.unmount();
    view.client.clear();
  });

  it("searches acknowledged history and performs acknowledge/bookmark/copy actions", async () => {
    const view = renderCard();
    await findMessageRow(view, "msg_active");
    expect(document.body.querySelector('.ws-search-shell-content[data-portalled="true"]')).toBeNull();
    expect(view.queryByRole("listbox")).toBeNull();
    const row = await findMessageRow(view, "msg_active");
    fireEvent.click(within(row).getByRole("button", { name: /Acknowledge/ }));
    fireEvent.click(within(await findMessageRow(view, "msg_saved")).getByRole("button", { name: /bookmark/i }));
    expect(within(row).getByRole("button", { name: /Copy message ID msg_active/ })).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Search Inbox" }));
    const search = view.getByRole("searchbox", { name: "Search Inbox messages" });
    expect(view.getByRole("button", { name: "Search Inbox" }).getAttribute("aria-expanded")).toBe("true");
    fireEvent.change(search, { target: { value: "handoff" } });
    expect(await findMessageRow(view, "msg_history")).toBeTruthy();
    expect(view.getByText("Old handoff")).toBeTruthy();
    fireEvent.keyDown(search, { key: "Escape" });
    await waitFor(() => expect(view.queryByRole("searchbox", { name: "Search Inbox messages" })).toBeNull());
    expect(view.getByRole("button", { name: "Search Inbox" }).getAttribute("aria-expanded")).toBe("false");
    view.unmount();
    view.client.clear();
  });

  it("keeps retry and mutation busy states accessible", async () => {
    rpcClient.call.mockRejectedValueOnce(new Error("Inbox unavailable"));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(
      <QueryClientProvider client={client}>
        <InboxCard threadId="thr_one" />
      </QueryClientProvider>,
    );
    expect((await view.findByRole("alert")).textContent).toContain("Inbox unavailable");
    fireEvent.click(view.getByRole("button", { name: "Retry Inbox" }));
    await waitFor(() => expect(rpcClient.call).toHaveBeenCalled());
    view.unmount();
    client.clear();
  });

  it.each([false, true])("disables Load more throughout a background fetch (search=%s)", async (search) => {
    const loaded = { messages: [active], cursor: "next", activeCount: 1, savedCount: 0, historyCount: 0 };
    rpcClient.call.mockResolvedValue(loaded);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><InboxCard threadId="thr_one" /></QueryClientProvider>);
    await findMessageRow(view, "msg_active");
    if (search) {
      fireEvent.click(view.getByRole("button", { name: "Search Inbox" }));
      fireEvent.change(view.getByRole("searchbox"), { target: { value: "history" } });
      await view.findByRole("region", { name: "Inbox search results" });
      await waitFor(() => expect(client.isFetching()).toBe(0));
    }
    let finish!: (value: typeof loaded) => void;
    rpcClient.call.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    act(() => { void client.invalidateQueries({ queryKey: ["work-sidebar", "inbox", "thr_one"] }); });
    await waitFor(() => expect(client.isFetching()).toBe(1));
    const button = view.container.querySelector<HTMLButtonElement>(".ws-inbox-load-more")!;
    await waitFor(() => expect(button.disabled).toBe(true));
    await act(async () => finish(loaded));
    await waitFor(() => expect(button.disabled).toBe(false));
    view.unmount(); client.clear();
  });

  it("keeps loaded rows and disclosure state mounted while loading a later cursor", async () => {
    let resolveLaterPage!: (value: { messages: HumanMessage[]; cursor: null; activeCount: number; savedCount: number; historyCount: number }) => void;
    rpcClient.call.mockImplementation((method: string, input: { cursor?: string }) => {
      if (method !== "listHumanMessages") return Promise.resolve(active);
      if (!input.cursor) return Promise.resolve({ messages: [active, saved], cursor: "later", activeCount: 1, savedCount: 1, historyCount: 0 });
      return new Promise((resolve) => { resolveLaterPage = resolve; });
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><InboxCard threadId="thr_one" /></QueryClientProvider>);
    await findMessageRow(view, "msg_active");
    const savedDisclosure = view.getByRole("button", { name: /^Saved:/ });
    fireEvent.click(savedDisclosure);
    expect(savedDisclosure.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(view.getByRole("button", { name: "Load more messages" }));
    expect(view.container.querySelector('[data-message-id="msg_active"]')).toBeTruthy();
    expect(savedDisclosure.getAttribute("aria-expanded")).toBe("false");
    resolveLaterPage({ messages: [{ ...active, id: "msg_later" }], cursor: null, activeCount: 2, savedCount: 1, historyCount: 0 });
    expect(await findMessageRow(view, "msg_later")).toBeTruthy();
    expect(savedDisclosure.getAttribute("aria-expanded")).toBe("false");
    view.unmount();
    client.clear();
  });

  it("keeps loaded rows visible and retries a failed later page", async () => {
    let laterAttempts = 0;
    rpcClient.call.mockImplementation((method: string, input: { cursor?: string }) => {
      if (method !== "listHumanMessages") return Promise.resolve(active);
      if (!input.cursor) return Promise.resolve({ messages: [active, saved], cursor: "later", activeCount: 1, savedCount: 1, historyCount: 0 });
      laterAttempts += 1;
      return laterAttempts === 1
        ? Promise.reject(new Error("later page unavailable"))
        : Promise.resolve({ messages: [{ ...active, id: "msg_retried" }], cursor: null, activeCount: 2, savedCount: 1, historyCount: 0 });
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><InboxCard threadId="thr_one" /></QueryClientProvider>);
    await findMessageRow(view, "msg_active");
    fireEvent.click(view.getByRole("button", { name: "Load more messages" }));
    expect((await view.findByRole("alert")).textContent).toContain("later page unavailable");
    expect(view.container.querySelector('[data-message-id="msg_active"]')).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Retry loading messages" }));
    expect(await findMessageRow(view, "msg_retried")).toBeTruthy();
    view.unmount();
    client.clear();
  });

  it("clears a mounted mutation error after retry succeeds", async () => {
    let mutationAttempts = 0;
    let resolveRetry!: (value: Omit<typeof active, "bookmarkedAt" | "revision"> & { bookmarkedAt: string; revision: number }) => void;
    rpcClient.call.mockImplementation((method: string) => {
      if (method === "listHumanMessages") return Promise.resolve({ messages: [active], cursor: null, activeCount: 1, savedCount: 0, historyCount: 0 });
      mutationAttempts += 1;
      return mutationAttempts === 1
        ? Promise.reject(new Error("Action unavailable"))
        : new Promise((resolve) => { resolveRetry = resolve; });
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><InboxCard threadId="thr_one" /></QueryClientProvider>);
    const row = await findMessageRow(view, "msg_active");
    fireEvent.click(within(row).getByRole("button", { name: /Bookmark message/ }));
    expect((await within(row).findByRole("alert")).textContent).toContain("Action unavailable");
    fireEvent.click(within(row).getByRole("button", { name: /Bookmark message/ }));
    await waitFor(() => expect(row.getAttribute("data-busy")).toBe("true"));
    resolveRetry({ ...active, bookmarkedAt: "2026-09-06T00:02:00.000Z", revision: 2 });
    await waitFor(() => expect(within(row).queryByRole("alert")).toBeNull());
    expect(
      within(row)
        .getByRole("button", { name: /Remove bookmark from message/ })
        .querySelector('[data-icon="BookmarkX"] path'),
    ).toBeTruthy();
    view.unmount();
    client.clear();
  });

  it("lets the latest cross-action success clear an earlier failure", async () => {
    let resolveBookmark!: (value: Omit<typeof active, "bookmarkedAt" | "revision"> & { bookmarkedAt: string; revision: number }) => void;
    rpcClient.call.mockImplementation((method: string) => {
      if (method === "listHumanMessages") return Promise.resolve({ messages: [active], cursor: null, activeCount: 1, savedCount: 0, historyCount: 0 });
      return method === "acknowledgeHumanMessage"
        ? Promise.reject(new Error("Acknowledgement unavailable"))
        : new Promise((resolve) => { resolveBookmark = resolve; });
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><InboxCard threadId="thr_one" /></QueryClientProvider>);
    const row = await findMessageRow(view, "msg_active");
    fireEvent.click(within(row).getByRole("button", { name: /Acknowledge message/ }));
    expect((await within(row).findByRole("alert")).textContent).toContain("Acknowledgement unavailable");
    fireEvent.click(within(row).getByRole("button", { name: /Bookmark message/ }));
    await waitFor(() => expect(row.getAttribute("data-busy")).toBe("true"));
    resolveBookmark({ ...active, bookmarkedAt: "2026-09-06T00:02:00.000Z", revision: 2 });
    await waitFor(() => expect(within(row).queryByRole("alert")).toBeNull());
    view.unmount();
    client.clear();
  });

  it("keeps loaded rows and offers a refresh retry after a background failure", async () => {
    let refreshAttempts = 0;
    rpcClient.call.mockImplementation((method: string) => {
      if (method !== "listHumanMessages") return Promise.resolve(active);
      refreshAttempts += 1;
      return refreshAttempts === 1
        ? Promise.resolve({ messages: [active], cursor: null, activeCount: 1, savedCount: 0, historyCount: 0 })
        : refreshAttempts === 2
          ? Promise.reject(new Error("Refresh unavailable"))
          : Promise.resolve({ messages: [active], cursor: null, activeCount: 1, savedCount: 0, historyCount: 0 });
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><InboxCard threadId="thr_one" /></QueryClientProvider>);
    await findMessageRow(view, "msg_active");
    await act(async () => { await client.refetchQueries(); });
    expect((await view.findByRole("alert")).textContent).toContain("Could not refresh Inbox: Refresh unavailable");
    expect(view.container.querySelector('[data-message-id="msg_active"]')).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Retry Inbox" }));
    await waitFor(() => expect(refreshAttempts).toBe(3));
    await waitFor(() => expect(view.queryByText(/Could not refresh Inbox/)).toBeNull());
    view.unmount();
    client.clear();
  });

  it("scopes busy and mutation errors to the row whose action was invoked", async () => {
    let rejectAcknowledgement!: (error: Error) => void;
    rpcClient.call.mockImplementation((method: string) => method === "listHumanMessages"
      ? Promise.resolve({ messages: [active, saved], cursor: null, activeCount: 1, savedCount: 1, historyCount: 0 })
      : new Promise((_resolve, reject) => { rejectAcknowledgement = reject; }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><InboxCard threadId="thr_one" /></QueryClientProvider>);
    const activeRow = await findMessageRow(view, "msg_active");
    const savedRow = await findMessageRow(view, "msg_saved");
    fireEvent.click(within(activeRow).getByRole("button", { name: /Bookmark message/ }));
    await waitFor(() => expect(activeRow.getAttribute("data-busy")).toBe("true"));
    expect((within(savedRow).getByRole("button", { name: /Remove bookmark/ }) as HTMLButtonElement).disabled).toBe(false);
    rejectAcknowledgement(new Error("Message changed"));
    expect((await within(activeRow).findByRole("alert")).textContent).toContain("Message changed");
    expect(within(savedRow).queryByRole("alert")).toBeNull();
    view.unmount();
    client.clear();
  });

  it("keeps rapid different-row actions and errors local to their originating rows", async () => {
    const rejecters: ((error: Error) => void)[] = [];
    rpcClient.call.mockImplementation((method: string) => method === "listHumanMessages"
      ? Promise.resolve({ messages: [active, saved], cursor: null, activeCount: 1, savedCount: 1, historyCount: 0 })
      : new Promise((_resolve, reject) => { rejecters.push(reject); }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><InboxCard threadId="thr_one" /></QueryClientProvider>);
    const activeRow = await findMessageRow(view, "msg_active");
    const savedRow = await findMessageRow(view, "msg_saved");
    fireEvent.click(within(activeRow).getByRole("button", { name: /Bookmark message/ }));
    fireEvent.click(within(savedRow).getByRole("button", { name: /Remove bookmark/ }));
    await waitFor(() => {
      expect(activeRow.getAttribute("data-busy")).toBe("true");
      expect(savedRow.getAttribute("data-busy")).toBe("true");
    });
    await act(async () => { rejecters[0]?.(new Error("First row changed")); });
    expect((await within(activeRow).findByRole("alert")).textContent).toContain("First row changed");
    expect(savedRow.getAttribute("data-busy")).toBe("true");
    expect(within(savedRow).queryByRole("alert")).toBeNull();
    view.unmount();
    client.clear();
  });

  it("unmounts closed group rows and restores their message bodies collapsed", async () => {
    const diagramMessage = { ...active, body: "```mermaid\nflowchart TD\n A-->B\n```" };
    const view = renderCard([diagramMessage]);
    const row = await findMessageRow(view, "msg_active");
    fireEvent.click(within(row).getByRole("button", { name: "Expand message body" }));
    expect(await view.findByLabelText("Mermaid diagram source")).toBeTruthy();
    const inbox = view.getByRole("button", { name: /^Messages:/ });
    const panelId = inbox.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    fireEvent.click(inbox);
    expect(view.container.querySelector('[data-message-id="msg_active"]')).toBeNull();
    expect(view.queryByLabelText("Mermaid diagram source")).toBeNull();
    expect(view.container.querySelector(`[id="${panelId}"]`)).toBeNull();
    fireEvent.click(inbox);
    const restored = await findMessageRow(view, "msg_active");
    expect(within(restored).getByRole("button", { name: "Expand message body" })).toBeTruthy();
    expect(view.queryByLabelText("Mermaid diagram source")).toBeNull();
    fireEvent.click(within(restored).getByRole("button", { name: "Expand message body" }));
    expect(await view.findByLabelText("Mermaid diagram source")).toBeTruthy();
    view.unmount();
    view.client.clear();
  });

  it("keeps fenced Mermaid as an accessible source fallback and passes axe", async () => {
    const view = render(
      <InboxMessageContent content={"Before\n```mermaid\nflowchart TD\n A-->B\n```\nAfter"} />,
    );
    expect(view.getByLabelText("Mermaid diagram source").textContent).toContain("flowchart TD");
    expect(view.getByText("Mermaid rendering is disabled in this bundle; showing source.")).toBeTruthy();
    const card = renderCard();
    await findMessageRow(card, "msg_active");
    fireEvent.click(card.getByRole("button", { name: "Search Inbox" }));
    const search = card.getByRole("searchbox", { name: "Search Inbox messages" });
    search.focus();
    expect(document.activeElement).toBe(search);
    expect(await axe(card.container)).toHaveNoViolations();
    view.unmount();
    card.unmount();
    card.client.clear();
  });
});

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configureAxe } from "vitest-axe";
import { InboxCard, InboxMessageContent } from "../views";

const axe = configureAxe({
  runOnly: { type: "tag", values: ["cat.aria", "cat.name-role-value"] },
});

const { rpcClient, markdown } = vi.hoisted(() => ({
  rpcClient: { call: vi.fn() },
  markdown: vi.fn(({ content }: { content: string }) => <div data-testid="markdown">{content}</div>),
}));

vi.mock("@get-bb/plugin-sdk/app", () => ({
  useRpc: () => rpcClient,
  useRealtime: () => undefined,
  Markdown: markdown,
}));

const active = {
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

function renderCard(messages = [active, saved], options: { query?: string } = {}) {
  rpcClient.call.mockImplementation(async (method: string, input: { query?: string }) => {
    if (method === "listHumanMessages" && input.query) return { messages: [history], cursor: null, activeCount: 1, savedCount: 1 };
    return { messages, cursor: null, activeCount: 4, savedCount: 7 };
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <InboxCard threadId="thr_one" />
    </QueryClientProvider>,
  );
  return { ...view, client };
}

afterEach(() => {
  cleanup();
  rpcClient.call.mockReset();
  vi.clearAllMocks();
});

describe("Inbox Work card", () => {
  it("renders shared collapsible Inbox/Saved groups, Markdown, IDs, and no delete action", async () => {
    const view = renderCard();
    expect(await view.findByRole("heading", { name: "Inbox" })).toBeTruthy();
    await view.findByText("msg_active");
    expect(view.getByRole("button", { name: /Inbox messages/ })).toBeTruthy();
    expect(view.getByRole("button", { name: /Saved messages/ })).toBeTruthy();
    expect(view.getByRole("button", { name: /Inbox messages/ }).textContent).toContain("4");
    expect(view.getByRole("button", { name: /Saved messages/ }).textContent).toContain("7");
    expect(view.getByText("msg_active")).toBeTruthy();
    expect(view.getByText("msg_saved")).toBeTruthy();
    expect(view.getAllByText("**Markdown** and 😀")).toHaveLength(2);
    expect(view.queryByRole("button", { name: /delete/i })).toBeNull();
    view.unmount();
    view.client.clear();
  });

  it("searches acknowledged history and performs acknowledge/bookmark/copy actions", async () => {
    const view = renderCard();
    await view.findByText("msg_active");
    expect(document.body.querySelector('.ws-search-shell-content[data-portalled="true"]')).toBeNull();
    expect(view.queryByRole("listbox")).toBeNull();
    const row = view.getByText("msg_active").closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: /Acknowledge/ }));
    fireEvent.click(within(view.getByText("msg_saved").closest("li")!).getByRole("button", { name: /bookmark/i }));
    expect(within(row).getByRole("button", { name: /Copy message ID msg_active/ })).toBeTruthy();
    const search = view.getByRole("searchbox", { name: "Search Inbox messages" });
    fireEvent.change(search, { target: { value: "handoff" } });
    expect(await view.findByText("msg_history")).toBeTruthy();
    expect(view.getByText("Old handoff")).toBeTruthy();
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

  it("keeps loaded rows and disclosure state mounted while loading a later cursor", async () => {
    let resolveLaterPage!: (value: { messages: (typeof active)[]; cursor: null; activeCount: number; savedCount: number }) => void;
    rpcClient.call.mockImplementation((method: string, input: { cursor?: string }) => {
      if (method !== "listHumanMessages") return Promise.resolve(active);
      if (!input.cursor) return Promise.resolve({ messages: [active, saved], cursor: "later", activeCount: 1, savedCount: 1 });
      return new Promise((resolve) => { resolveLaterPage = resolve; });
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><InboxCard threadId="thr_one" /></QueryClientProvider>);
    await view.findByText("msg_active");
    const savedDisclosure = view.getByRole("button", { name: /Saved messages/ });
    fireEvent.click(savedDisclosure);
    expect(savedDisclosure.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(view.getByRole("button", { name: "Load more messages" }));
    expect(view.getByText("msg_active")).toBeTruthy();
    expect(savedDisclosure.getAttribute("aria-expanded")).toBe("false");
    resolveLaterPage({ messages: [{ ...active, id: "msg_later" }], cursor: null, activeCount: 2, savedCount: 1 });
    expect(await view.findByText("msg_later")).toBeTruthy();
    expect(savedDisclosure.getAttribute("aria-expanded")).toBe("false");
    view.unmount();
    client.clear();
  });

  it("keeps loaded rows visible and retries a failed later page", async () => {
    let laterAttempts = 0;
    rpcClient.call.mockImplementation((method: string, input: { cursor?: string }) => {
      if (method !== "listHumanMessages") return Promise.resolve(active);
      if (!input.cursor) return Promise.resolve({ messages: [active, saved], cursor: "later", activeCount: 1, savedCount: 1 });
      laterAttempts += 1;
      return laterAttempts === 1
        ? Promise.reject(new Error("later page unavailable"))
        : Promise.resolve({ messages: [{ ...active, id: "msg_retried" }], cursor: null, activeCount: 2, savedCount: 1 });
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><InboxCard threadId="thr_one" /></QueryClientProvider>);
    await view.findByText("msg_active");
    fireEvent.click(view.getByRole("button", { name: "Load more messages" }));
    expect((await view.findByRole("alert")).textContent).toContain("later page unavailable");
    expect(view.getByText("msg_active")).toBeTruthy();
    fireEvent.click(view.getByRole("button", { name: "Retry loading messages" }));
    expect(await view.findByText("msg_retried")).toBeTruthy();
    view.unmount();
    client.clear();
  });

  it("scopes busy and mutation errors to the row whose action was invoked", async () => {
    let rejectAcknowledgement!: (error: Error) => void;
    rpcClient.call.mockImplementation((method: string) => method === "listHumanMessages"
      ? Promise.resolve({ messages: [active, saved], cursor: null, activeCount: 1, savedCount: 1 })
      : new Promise((_resolve, reject) => { rejectAcknowledgement = reject; }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><InboxCard threadId="thr_one" /></QueryClientProvider>);
    const activeRow = (await view.findByText("msg_active")).closest("li")!;
    const savedRow = view.getByText("msg_saved").closest("li")!;
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
      ? Promise.resolve({ messages: [active, saved], cursor: null, activeCount: 1, savedCount: 1 })
      : new Promise((_resolve, reject) => { rejecters.push(reject); }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}><InboxCard threadId="thr_one" /></QueryClientProvider>);
    const activeRow = (await view.findByText("msg_active")).closest("li")!;
    const savedRow = view.getByText("msg_saved").closest("li")!;
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

  it("unmounts closed group bodies and restores them on reopen", async () => {
    const diagramMessage = { ...active, body: "```mermaid\nflowchart TD\n A-->B\n```" };
    const view = renderCard([diagramMessage]);
    await view.findByText("msg_active");
    const inbox = view.getByRole("button", { name: /Inbox messages/ });
    const panelId = inbox.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    fireEvent.click(inbox);
    expect(view.queryByText("msg_active")).toBeNull();
    expect(view.queryByLabelText("Mermaid diagram source")).toBeNull();
    expect(view.container.querySelector(`[id="${panelId}"]`)).toBeNull();
    fireEvent.click(inbox);
    expect(await view.findByText("msg_active")).toBeTruthy();
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
    await card.findByText("msg_active");
    const search = card.getByRole("searchbox", { name: "Search Inbox messages" });
    search.focus();
    expect(document.activeElement).toBe(search);
    expect(await axe(card.container)).toHaveNoViolations();
    view.unmount();
    card.unmount();
    card.client.clear();
  });
});

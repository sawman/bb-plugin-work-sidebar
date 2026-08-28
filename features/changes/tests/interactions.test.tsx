// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { changesKeys } from "../model";
import { useCheckoutStackBranch, useWorkingTreeFileDiff } from "../queries";
import { createChangesInteractionStore } from "../store";
import { ChangesRepositoryCard, ChangesWorkingTreePreview } from "../views";

vi.mock("@get-bb/plugin-sdk/app", () => ({
  experimental_Diff: ({ patch, path }: { patch: string; path: string }) => <pre data-renderer="diff" data-path={path}>{patch}</pre>,
  experimental_SourceCode: ({ content, path }: { content: string; path: string }) => <pre data-renderer="source" data-path={path}>{content}</pre>,
}));

afterEach(cleanup);

function wrapper(client: QueryClient) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

describe("R14 Changes interactions", () => {
  it("keys lazy working-tree previews by the owning thread, fingerprint, and path", async () => {
    const rpc = {
      call: vi.fn(async () => ({
        kind: "patch" as const,
        path: "src/file.ts",
        patch: "@@ -1 +1 @@\n-old\n+new",
        message: null,
      })),
    };
    const client = new QueryClient();
    const view = render(
      <PreviewHarness rpc={rpc} threadId="thr_one" path="src/file.ts" fingerprint="one" />,
      { wrapper: wrapper(client) },
    );

    await waitFor(() => expect(rpc.call).toHaveBeenCalledOnce());
    await waitFor(() => expect(view.container.querySelector('[data-renderer="diff"]')?.getAttribute("data-path")).toBe("src/file.ts"));
    expect(rpc.call).toHaveBeenCalledWith("getWorkingTreeFileDiff", {
      threadId: "thr_one",
      path: "src/file.ts",
    });
    expect(client.getQueryCache().find({
      queryKey: changesKeys.fileDiff("thr_one", "one", "src/file.ts"),
    })).toBeDefined();

    view.rerender(
      <PreviewHarness rpc={rpc} threadId="thr_two" path="src/file.ts" fingerprint="two" />,
    );
    await waitFor(() => expect(rpc.call).toHaveBeenCalledTimes(2));
    expect(client.getQueryCache().find({
      queryKey: changesKeys.fileDiff("thr_one", "one", "src/file.ts"),
    })).toBeDefined();
    expect(client.getQueryCache().find({
      queryKey: changesKeys.fileDiff("thr_two", "two", "src/file.ts"),
    })).toBeDefined();
  });

  it("adapts non-patch text through the host source renderer and keeps selection isolated by thread", () => {
    const preview = render(
      <ChangesWorkingTreePreview
        path="notes.txt"
        query={{
          data: { kind: "patch", path: "notes.txt", patch: "plain text", message: null },
          error: null,
          isError: false,
          isPending: false,
        }}
        onClose={() => undefined}
      />,
    );
    expect(preview.container.querySelector('[data-renderer="source"]')?.getAttribute("data-path")).toBe("notes.txt");

    const store = createChangesInteractionStore();
    store.getState().selectFile("thr_one", "one.ts");
    store.getState().selectFile("thr_two", "two.ts");
    store.getState().selectFile("thr_one", null);
    expect(store.getState().byThread.get("thr_one")?.selectedFilePath).toBeNull();
    expect(store.getState().byThread.get("thr_two")?.selectedFilePath).toBe("two.ts");
  });

  it("uses an accessible X icon to close the working-tree diff", () => {
    const close = vi.fn();
    const preview = render(
      <ChangesWorkingTreePreview
        path="src/file.ts"
        query={{
          data: { kind: "absent", path: "src/file.ts", patch: null, message: "No diff." },
          error: null,
          isError: false,
          isPending: false,
        }}
        onClose={close}
      />,
    );

    const button = preview.getByRole("button", {
      name: "Close diff for src/file.ts",
    });
    expect(button.textContent).toBe("");
    expect(button.querySelector('[data-icon="X"]')).not.toBeNull();
    fireEvent.click(button);
    expect(close).toHaveBeenCalledOnce();
  });

  it("does not load a preview until a file is selected, supports close, and exposes binary, absent, and unavailable fallbacks", async () => {
    const rpc = {
      call: vi.fn(async (_method: string, input: { path: string }) => ({
        kind: input.path as "binary" | "absent" | "unavailable",
        path: input.path,
        patch: null,
        message: `${input.path} preview`,
      })),
    };
    const client = new QueryClient();
    const close = vi.fn();
    const view = render(
      <PreviewHarness rpc={rpc} threadId="thr_one" path={null} fingerprint="one" onClose={close} />,
      { wrapper: wrapper(client) },
    );
    expect(rpc.call).not.toHaveBeenCalled();

    for (const kind of ["binary", "absent", "unavailable"] as const) {
      view.rerender(
        <PreviewHarness rpc={rpc} threadId="thr_one" path={kind} fingerprint="one" onClose={close} />,
      );
      await waitFor(() => expect(screen.getByText(`${kind} preview`)).toBeTruthy());
    }
    fireEvent.click(screen.getByRole("button", { name: "Close diff for unavailable" }));
    expect(close).toHaveBeenCalledOnce();
  });

  it("uses a native focusable button for opening a working-tree file preview", () => {
    const open = vi.fn();
    render(
      <ChangesRepositoryCard
        repository={{
          outcome: "available",
          message: null,
          branch: "main",
          base: "main",
          ahead: 0,
          behind: 0,
          worktreeState: "dirty_uncommitted",
          hasUncommittedChanges: true,
          changedFileCount: 1,
          changedInsertions: 1,
          changedDeletions: 0,
          changedFiles: [{ path: "src/file.ts", status: "modified", insertions: 1, deletions: 0 }],
        }}
        loading={false}
        expanded
        onToggle={() => undefined}
        onOpenFile={open}
      />,
    );
    const file = screen.getByRole("button", { name: "Open uncommitted diff for src/file.ts" });
    file.focus();
    expect(document.activeElement).toBe(file);
    fireEvent.click(file);
    expect(open).toHaveBeenCalledOnce();
  });

  it("renders every received working-tree file without a local truncation notice", () => {
    const changedFiles = Array.from({ length: 8 }, (_, index) => ({
      path: `src/visible-${index + 1}.ts`,
      status: "modified",
      insertions: index,
      deletions: 0,
    }));
    const { container } = render(
      <ChangesRepositoryCard
        repository={{
          outcome: "available",
          message: null,
          branch: "main",
          base: "main",
          ahead: 0,
          behind: 0,
          worktreeState: "dirty_uncommitted",
          hasUncommittedChanges: true,
          changedFileCount: 12,
          changedInsertions: 28,
          changedDeletions: 0,
          changedFiles,
        }}
        loading={false}
        expanded
        onToggle={() => undefined}
        onOpenFile={() => undefined}
      />,
    );

    expect(screen.getByText("src/visible-8.ts")).toBeTruthy();
    expect(screen.queryByText(/Only the first .* files are shown/)).toBeNull();
    expect(
      container
        .querySelector(".ws-stack-files")
        ?.classList.contains("ws-changes-file-list-scroll"),
    ).toBe(true);
  });

  it("keeps checkout busy until it settles, reports success/failure, and invalidates only the owning Changes thread", async () => {
    let resolve!: (value: { ok: boolean; message: string; tone?: "success" | "warning" | "error"; detail: null }) => void;
    const pending = new Promise<{ ok: boolean; message: string; tone?: "success" | "warning" | "error"; detail: null }>((next) => {
      resolve = next;
    });
    const rpc = { call: vi.fn(() => pending) };
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    render(<CheckoutHarness rpc={rpc} threadId="thr_one" />, { wrapper: wrapper(client) });

    fireEvent.click(screen.getByRole("button", { name: "Check out feature/one" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Checking out feature/one" }).hasAttribute("disabled")).toBe(true));
    await act(async () => resolve({ ok: true, message: "Checked out", detail: null }));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Checked out"));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: changesKeys.projection("thr_one") });

    rpc.call.mockResolvedValueOnce({ ok: false, message: "Cannot check out", tone: "error", detail: null });
    fireEvent.click(screen.getByRole("button", { name: "Check out feature/one" }));
    await waitFor(() => expect(screen.getByRole("alert").textContent).toBe("Cannot check out"));
  });
});

function PreviewHarness({
  rpc,
  threadId,
  path,
  fingerprint,
  onClose = () => undefined,
}: {
  rpc: { call: ReturnType<typeof vi.fn> };
  threadId: string;
  path: string | null;
  fingerprint: string | null;
  onClose?: () => void;
}) {
  const query = useWorkingTreeFileDiff(rpc as never, threadId, fingerprint, path);
  return path ? <ChangesWorkingTreePreview path={path} query={query} onClose={onClose} /> : null;
}

function CheckoutHarness({ rpc, threadId }: { rpc: { call: ReturnType<typeof vi.fn> }; threadId: string }) {
  const checkout = useCheckoutStackBranch(rpc as never, threadId);
  return <>
    <button
      type="button"
      aria-label={checkout.isPending ? "Checking out feature/one" : "Check out feature/one"}
      disabled={checkout.isPending}
      onClick={() => checkout.mutate("feature/one")}
    >
      Check out
    </button>
    {checkout.isSuccess && <output role="status">{checkout.data.message}</output>}
    {checkout.isError && <output role="alert">{checkout.error.message}</output>}
    {checkout.data && !checkout.data.ok && <output role="alert">{checkout.data.message}</output>}
  </>;
}

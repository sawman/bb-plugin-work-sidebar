// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createRef, type PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configureAxe } from "vitest-axe";
import { PullRequestReviewerPicker } from "../reviewer-picker";
import type { PullRequestRpc } from "../queries";
import { AuthoredPullRequestRow } from "../authored-pull-requests";

const axe = configureAxe({
  runOnly: {
    type: "tag",
    values: ["cat.aria", "cat.name-role-value"],
  },
});

async function expectNoAriaViolations() {
  const result = await axe(document.body);
  expect(result.violations).toEqual([]);
  expect(result.incomplete).toEqual([]);
}

function wrapper(client: QueryClient) {
  return function QueryWrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

describe("pull-request reviewer picker", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("searches a multi-select and applies both reviewer additions and removals", async () => {
    const close = vi.fn();
    const rpc = {
      call: vi.fn(async (method: string, input: unknown) => {
        if (method === "getPullRequestReviewers")
          return {
            available: true,
            reviewers: [
              { login: "alice", name: "Alice Example", avatarUrl: null },
              { login: "bob", name: "Bob Builder", avatarUrl: null },
            ],
            error: null,
          };
        if (method === "updatePullRequestReviewers") {
          expect(input).toEqual({
            repository: "acme/sidebar",
            number: 42,
            reviewers: ["bob"],
          });
          return { reviewers: ["bob"] };
        }
        throw new Error(`unexpected ${method}`);
      }),
    } as unknown as PullRequestRpc;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const anchorRef = createRef<HTMLButtonElement>();
    const { unmount } = render(
      <>
        <button ref={anchorRef}>Review status</button>
        <PullRequestReviewerPicker
          rpc={rpc}
          repository="acme/sidebar"
          number={42}
          title="Reviewer interaction"
          requestedReviewers={["alice"]}
          anchorRef={anchorRef}
          onClose={close}
        />
      </>,
      { wrapper: wrapper(client) },
    );

    expect(await screen.findByText("Reviewers for PR #42")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      (
        await screen.findByRole("option", { name: /alice.*Alice Example/i })
      ).getAttribute("aria-selected"),
    ).toBe("true");
    const search = screen.getByRole("combobox", { name: "Search reviewers" });
    const listbox = screen.getByRole("listbox", { name: "Available reviewers" });
    expect(listbox.closest("[data-portalled=true]")).toBeTruthy();
    expect(search.getAttribute("aria-expanded")).toBe("true");
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(search.getAttribute("aria-activedescendant")).toBe(
      screen.getByRole("option", { name: /alice.*Alice Example/i }).id,
    );
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(search.getAttribute("aria-activedescendant")).toBe(
      screen.getByRole("option", { name: /bob.*Bob Builder/i }).id,
    );
    await expectNoAriaViolations();
    fireEvent.change(search, {
      target: { value: "builder" },
    });
    expect(screen.queryByRole("option", { name: /alice/ })).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: /bob.*Bob Builder/i }));
    fireEvent.change(search, {
      target: { value: "" },
    });
    fireEvent.click(
      screen.getByRole("option", { name: /alice.*Alice Example/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Save reviewers" }));

    await waitFor(() =>
      expect(rpc.call).toHaveBeenCalledWith("updatePullRequestReviewers", {
        repository: "acme/sidebar",
        number: 42,
        reviewers: ["bob"],
      }),
    );
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    unmount();
    client.clear();
  });

  it("keeps the empty reviewer search announced without a stale listbox", async () => {
    const rpc = {
      call: vi.fn(async () => ({
        available: true,
        reviewers: [{ login: "alice", name: null, avatarUrl: null }],
        error: null,
      })),
    } as unknown as PullRequestRpc;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <PullRequestReviewerPicker
        rpc={rpc}
        repository="acme/sidebar"
        number={42}
        title="Reviewer interaction"
        requestedReviewers={[]}
        anchorRef={createRef<HTMLButtonElement>()}
        onClose={vi.fn()}
      />,
      { wrapper: wrapper(client) },
    );

    const search = await screen.findByRole("combobox", {
      name: "Search reviewers",
    });
    await screen.findByRole("option", { name: "alice" });
    fireEvent.change(search, { target: { value: "missing" } });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("searchbox", { name: "Search reviewers" })).toBe(search);
    expect(search.hasAttribute("aria-controls")).toBe(false);
    expect(screen.getByText("No matching reviewers.")).toBeTruthy();
    await expectNoAriaViolations();
    client.clear();
  });

  it("keeps a failed mutation open, retries loading, and dismisses on Escape", async () => {
    const close = vi.fn();
    let listAttempts = 0;
    const rpc = {
      call: vi.fn(async (method: string) => {
        if (method === "getPullRequestReviewers") {
          listAttempts += 1;
          if (listAttempts <= 2)
            return {
              available: false,
              reviewers: [],
              error: "Directory failed",
            };
          return {
            available: true,
            reviewers: [{ login: "alice", name: null, avatarUrl: null }],
            error: null,
          };
        }
        if (method === "updatePullRequestReviewers")
          throw new Error("GitHub refused reviewers");
        throw new Error(`unexpected ${method}`);
      }),
    } as unknown as PullRequestRpc;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, retryDelay: 1 } },
    });
    render(
      <PullRequestReviewerPicker
        rpc={rpc}
        repository="acme/sidebar"
        number={42}
        title="Reviewer interaction"
        requestedReviewers={[]}
        anchorRef={createRef<HTMLButtonElement>()}
        onClose={close}
      />,
      { wrapper: wrapper(client) },
    );

    expect((await screen.findByRole("alert")).textContent).toContain(
      "Directory failed",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("option", { name: "alice" })).toBeTruthy();
    fireEvent.click(screen.getByRole("option", { name: "alice" }));
    fireEvent.click(screen.getByRole("button", { name: "Save reviewers" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "GitHub refused reviewers",
    );
    expect(close).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByRole("combobox", { name: "Search reviewers" }), { key: "Escape" });
    expect(close).toHaveBeenCalledOnce();
    client.clear();
  });

  it("opens the same picker from the PR context menu and review-status badge", async () => {
    const rpc = {
      call: vi.fn(async (method: string) => {
        if (method === "getPullRequestReviewers")
          return {
            available: true,
            reviewers: [{ login: "alice", name: null, avatarUrl: null }],
            error: null,
          };
        throw new Error(`unexpected ${method}`);
      }),
    } as unknown as PullRequestRpc;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <AuthoredPullRequestRow
        rpc={rpc}
        pullRequest={{
          number: 42,
          title: "Manage reviewers",
          url: "https://github.com/acme/sidebar/pull/42",
          repository: "acme/sidebar",
          state: "open",
          draft: false,
          head: "feature/reviewers",
          base: "main",
          checks: "passing",
          review: "review_required",
          requestedReviewers: ["alice"],
          reviewCommentCount: 0,
        }}
        changingDraft={false}
        onToggleDraft={vi.fn()}
      />,
      { wrapper: wrapper(client) },
    );

    fireEvent.contextMenu(
      screen.getByRole("link", {
        name: "Open pull request #42: Manage reviewers",
      }),
    );
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Request reviewers…" }),
    );
    expect(await screen.findByRole("combobox", { name: "Search reviewers" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Cancel" }),
    );
    await waitFor(() => expect(screen.queryByRole("combobox", { name: "Search reviewers" })).toBeNull());

    fireEvent.click(
      screen.getByRole("button", {
        name: "Manage reviewers: Review required",
      }),
    );
    expect(await screen.findByRole("combobox", { name: "Search reviewers" })).toBeTruthy();
    expect(
      screen.queryByRole("menuitem", { name: "Reviewers: alice" }),
    ).toBeNull();
    client.clear();
  });
});

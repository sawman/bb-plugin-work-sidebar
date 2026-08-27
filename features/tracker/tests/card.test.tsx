// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigate = { openUrl: vi.fn() };
const tracker = vi.fn(); const search = vi.fn(); const mutations = vi.fn();
vi.mock("@get-bb/plugin-sdk/app", () => ({ useBbNavigate: () => navigate, useRpc: () => ({}) }));
vi.mock("../queries", () => ({ useTracker: (...args: unknown[]) => tracker(...args), useTrackerSearch: (...args: unknown[]) => search(...args), useTrackerMutations: (...args: unknown[]) => mutations(...args) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
import { TrackerCard, TrackerHeaderBadge } from "../card";

const mutation = { isPending: false, mutateAsync: vi.fn().mockResolvedValue({}) };
const idleMutations = { link: mutation, unlink: mutation, status: mutation };
const base = { visible: true, available: true, message: null, suggestions: [{ key: "LIN-1", title: "First", url: "https://linear.app/issue/LIN-1" }], item: null, statusOptions: [] };

describe("TrackerCard", () => {
  beforeEach(() => { vi.clearAllMocks(); tracker.mockReturnValue({ data: base, isPending: false, isError: false }); search.mockReturnValue({ data: undefined, isFetching: false, isError: false, refetch: vi.fn() }); mutations.mockReturnValue(idleMutations); });
  it("renders bounded loading, error, empty suggestions and a non-Linear hidden state", () => {
    tracker.mockReturnValueOnce({ isPending: true }); const { rerender } = render(<TrackerCard threadId="thr_1" />); expect(screen.getByText("Loading linked work…")).toBeTruthy();
    tracker.mockReturnValue({ isPending: false, isError: true, error: new Error("offline"), refetch: vi.fn() }); rerender(<TrackerCard threadId="thr_1" />); expect(screen.getByRole("alert").textContent).toContain("offline");
    tracker.mockReturnValue({ data: { ...base, suggestions: [] }, isPending: false, isError: false }); rerender(<TrackerCard threadId="thr_1" />); expect(screen.getByText("No related issues found.")).toBeTruthy();
    tracker.mockReturnValue({ data: { ...base, visible: false }, isPending: false, isError: false }); rerender(<TrackerCard threadId="thr_1" />); expect(screen.queryByText("Linear")).toBeNull();
  });
  it("links suggestions, recovers busy controls, surfaces search failures, and navigates BB URLs", () => {
    render(<TrackerCard threadId="thr_1" />); fireEvent.click(screen.getByText("First")); expect(mutation.mutateAsync).toHaveBeenCalledWith("LIN-1");
    fireEvent.change(screen.getByLabelText("Search Linear issues"), { target: { value: "nope" } });
    search.mockReturnValue({ data: undefined, isFetching: false, isError: true, error: new Error("search failed"), refetch: vi.fn() });
    const linked = { ...base, item: { key: "LIN-1", title: "First", url: "https://linear.app/issue/LIN-1" }, statusOptions: [{ id: "todo", name: "Todo", current: true }] };
    tracker.mockReturnValue({ data: linked, isPending: false, isError: false }); render(<><TrackerHeaderBadge threadId="thr_1" /><TrackerCard threadId="thr_1" /></>); fireEvent.click(screen.getAllByText("LIN-1")[0]!); expect(navigate.openUrl).toHaveBeenCalledWith(linked.item.url);
  });
});

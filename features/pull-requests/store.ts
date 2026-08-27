import { createStore } from "zustand/vanilla";

type PullRequestsSidebarState = {
  selectedIds: Set<string>;
  selectionAnchorId: string | null;
  setSelected(anchorId: string | null, ids: Iterable<string>): void;
  reconcileRoster(ids: Iterable<string>): void;
};

export const pullRequestsSidebarStore = createStore<PullRequestsSidebarState>(
  (set) => ({
    selectedIds: new Set(),
    selectionAnchorId: null,
    setSelected: (selectionAnchorId, ids) =>
      set({ selectionAnchorId, selectedIds: new Set(ids) }),
    reconcileRoster: (ids) =>
      set((current) => {
        const roster = new Set(ids);
        return {
          selectedIds: new Set(
            [...current.selectedIds].filter((id) => roster.has(id)),
          ),
          selectionAnchorId:
            current.selectionAnchorId && roster.has(current.selectionAnchorId)
              ? current.selectionAnchorId
              : null,
        };
      }),
  }),
);

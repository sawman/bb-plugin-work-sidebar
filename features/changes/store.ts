import { createStore } from "zustand/vanilla";

type ChangesPresentation = {
  repositoryExpanded: boolean;
  currentPullRequestExpanded: boolean;
  expandedStackBranches: Set<string>;
  selectedFilePath: string | null;
  selectedPullRequestNumber: number | null;
};
export type ChangesInteractionState = {
  byThread: Map<string, ChangesPresentation>;
  toggleRepository(threadId: string): void;
  togglePullRequest(threadId: string): void;
  toggleStackBranch(threadId: string, branch: string): void;
  selectFile(threadId: string, path: string | null, pullRequestNumber?: number | null): void;
};
const empty = (): ChangesPresentation => ({
  repositoryExpanded: false,
  currentPullRequestExpanded: false,
  expandedStackBranches: new Set(),
  selectedFilePath: null,
  selectedPullRequestNumber: null,
});
const cap = (entries: Iterable<[string, ChangesPresentation]>) => {
  const next = new Map(entries);
  while (next.size > 40) next.delete(next.keys().next().value!);
  return next;
};
export function createChangesInteractionStore() {
  return createStore<ChangesInteractionState>((set) => ({
    byThread: new Map(),
    toggleRepository: (threadId) =>
      set((state) => {
        const byThread = new Map(state.byThread);
        const value = byThread.get(threadId) ?? empty();
        byThread.delete(threadId);
        byThread.set(threadId, {
          ...value,
          repositoryExpanded: !value.repositoryExpanded,
        });
        return { byThread: cap(byThread) };
      }),
    togglePullRequest: (threadId) =>
      set((state) => {
        const byThread = new Map(state.byThread);
        const value = byThread.get(threadId) ?? empty();
        byThread.delete(threadId);
        byThread.set(threadId, {
          ...value,
          currentPullRequestExpanded: !value.currentPullRequestExpanded,
        });
        return { byThread: cap(byThread) };
      }),
    toggleStackBranch: (threadId, branch) =>
      set((state) => {
        const byThread = new Map(state.byThread);
        const value = byThread.get(threadId) ?? empty();
        const expandedStackBranches = new Set(value.expandedStackBranches);
        expandedStackBranches.has(branch)
          ? expandedStackBranches.delete(branch)
          : expandedStackBranches.add(branch);
        byThread.delete(threadId);
        byThread.set(threadId, { ...value, expandedStackBranches });
        return { byThread: cap(byThread) };
      }),
    selectFile: (threadId, selectedFilePath, selectedPullRequestNumber = null) =>
      set((state) => {
        const byThread = new Map(state.byThread);
        const value = byThread.get(threadId) ?? empty();
        byThread.delete(threadId);
        byThread.set(threadId, {
          ...value,
          selectedFilePath,
          selectedPullRequestNumber: selectedFilePath
            ? selectedPullRequestNumber
            : null,
        });
        return { byThread: cap(byThread) };
      }),
  }));
}
export const changesInteractionStore = createChangesInteractionStore();

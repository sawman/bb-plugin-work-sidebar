import { createStore } from "zustand/vanilla";

export type TaskDropTarget = {
  taskId: string;
  placement: "before" | "after";
} | null;

type TasksSidebarState = {
  selectedIds: Set<string>;
  selectionAnchorId: string | null;
  dragTaskId: string | null;
  dropTarget: TaskDropTarget;
  setSelected(anchorId: string | null, ids: Iterable<string>): void;
  setDrag(taskId: string | null, target: TaskDropTarget): void;
  reconcileRoster(ids: Iterable<string>): void;
};

export const tasksSidebarStore = createStore<TasksSidebarState>((set) => ({
  selectedIds: new Set(),
  selectionAnchorId: null,
  dragTaskId: null,
  dropTarget: null,
  setSelected: (selectionAnchorId, ids) =>
    set({ selectionAnchorId, selectedIds: new Set(ids) }),
  setDrag: (dragTaskId, dropTarget) => set({ dragTaskId, dropTarget }),
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
        dragTaskId:
          current.dragTaskId && roster.has(current.dragTaskId)
            ? current.dragTaskId
            : null,
        dropTarget:
          current.dropTarget && roster.has(current.dropTarget.taskId)
            ? current.dropTarget
            : null,
      };
    }),
}));

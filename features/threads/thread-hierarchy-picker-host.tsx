import { ThreadHierarchyPicker } from "./thread-hierarchy-picker";
import { useThreadHierarchy } from "./thread-hierarchy-context";

/** The sidebar owns one inline hierarchy picker, independent of row count. */
export function ThreadHierarchyPickerHost() {
  const hierarchy = useThreadHierarchy();
  const picker = hierarchy.picker;
  return (
    <ThreadHierarchyPicker
      anchor={picker?.anchor ?? null}
      anchorRect={picker?.anchorRect ?? null}
      candidates={hierarchy.candidates}
      move={hierarchy.move}
      open={picker !== null}
      pendingThreadId={hierarchy.pendingThreadId}
      threadId={picker?.threadId ?? ""}
      title={picker?.title ?? ""}
      onClose={hierarchy.closePicker}
    />
  );
}

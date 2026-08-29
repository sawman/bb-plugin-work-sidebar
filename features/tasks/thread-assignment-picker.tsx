import { useMemo, useRef, useState } from "react";
import { SearchCombobox } from "../../components/ui/combobox";
import { CopyBadge } from "../../components/ui/copy-badge";
import { Icon } from "../../components/ui/icon";
import {
  ThreadProviderLogo,
  type ThreadProvider,
} from "../../components/threads/thread-provider-logo";

export type TaskThreadOption = {
  title: string;
  providerId: string;
  provider?: ThreadProvider;
};

export function ThreadAssignmentPicker({
  taskKey,
  linkedThreadIds,
  lockedThreadId,
  threads,
  disabled = false,
  onToggle,
}: {
  taskKey: string;
  linkedThreadIds: readonly string[];
  lockedThreadId: string | null;
  threads: ReadonlyMap<string, TaskThreadOption>;
  disabled?: boolean;
  onToggle(threadId: string, attached: boolean): void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const options = useMemo(() => {
    const available = new Map(threads);
    for (const threadId of linkedThreadIds) {
      if (!available.has(threadId))
        available.set(threadId, { title: threadId, providerId: "agent" });
    }
    return [...available.entries()].map(([threadId, thread]) => ({
      value: threadId,
      label: thread.title,
      disabled: disabled || lockedThreadId === threadId,
      leading: (
        <ThreadProviderLogo
          providerId={thread.providerId}
          provider={thread.provider}
        />
      ),
      trailing: linkedThreadIds.includes(threadId) ? <Icon name="Check" /> : null,
      title:
        lockedThreadId === threadId
          ? "Owned by this task's Work binding"
          : undefined,
    }));
  }, [disabled, linkedThreadIds, lockedThreadId, threads]);
  const primaryThreadId = lockedThreadId ?? linkedThreadIds[0] ?? null;
  const primaryThread = primaryThreadId
    ? (threads.get(primaryThreadId) ?? { title: primaryThreadId, providerId: "agent" })
    : undefined;

  return (
    <span className="ws-task-thread-picker">
      <span className="ws-task-thread-chip">
        {primaryThread ? (
          <CopyBadge
            className="ws-task-owner-badge"
            value={primaryThread.title}
            label="assigned thread"
            typography="context"
          >
            <ThreadProviderLogo
              providerId={primaryThread.providerId}
              provider={primaryThread.provider}
            />
            <span>{primaryThread.title}</span>
            {linkedThreadIds.length > 1 ? (
              <span className="ws-task-thread-count">+{linkedThreadIds.length - 1}</span>
            ) : null}
          </CopyBadge>
        ) : (
          <span className="ws-task-thread-empty">
            <Icon name="GitBranch" aria-hidden />
            <span>No thread</span>
          </span>
        )}
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          className="ws-task-thread-trigger"
          aria-label={`Edit threads for ${taskKey}`}
          title={`Edit threads for ${taskKey}`}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <Icon name="ChevronDown" aria-hidden />
        </button>
      </span>
      <SearchCombobox
        anchorRef={triggerRef}
        ariaLabel={`Search threads for ${taskKey}`}
        closeOnSelect={false}
        emptyMessage="No matching threads."
        listboxLabel={`Thread assignment for ${taskKey}`}
        multiple
        onOpenChange={setOpen}
        onSelectionChange={(next) => {
          const changed = options.find(
            (option) => next.includes(option.value) !== linkedThreadIds.includes(option.value),
          );
          if (changed) onToggle(changed.value, next.includes(changed.value));
        }}
        open={open}
        options={options}
        placeholder="Search threads…"
        portal
        selectedValues={linkedThreadIds}
      />
    </span>
  );
}

import { useMemo, useRef, useState } from "react";
import { SearchCombobox } from "../../components/ui/combobox";
import { CopyBadge } from "../../components/ui/copy-badge";
import { Icon } from "../../components/ui/icon";
import { ActionTooltip } from "../../components/ui/action-tooltip";
import {
  ThreadProviderLogo,
  type ThreadProvider,
} from "../../components/threads/thread-provider-logo";

export type TaskThreadOption = {
  title: string;
  providerId: string;
  provider?: ThreadProvider;
  unavailable?: boolean;
};

export function ThreadAssignmentPicker({
  taskKey,
  ownerThreadId,
  linkedThreadIds,
  lockedThreadId,
  threads,
  disabled = false,
  onToggle,
}: {
  taskKey: string;
  ownerThreadId: string | null;
  linkedThreadIds: readonly string[];
  lockedThreadId: string | null;
  threads: ReadonlyMap<string, TaskThreadOption>;
  disabled?: boolean;
  onToggle(threadId: string, attached: boolean): Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const ownerLocked = lockedThreadId !== null;
  const lockDescriptionId = `ws-task-owner-lock-${taskKey}`;
  const options = useMemo(() => {
    const available = new Map(threads);
    return [...available.entries()].map(([threadId, thread]) => ({
      value: threadId,
      label: thread.title,
      disabled: disabled || ownerLocked,
      leading: (
        <ThreadProviderLogo
          providerId={thread.providerId}
          provider={thread.provider}
        />
      ),
      trailing: ownerThreadId === threadId ? <Icon name="Check" /> : null,
      title: ownerLocked
        ? "This owner thread is managed by a durable Work binding."
        : undefined,
    }));
  }, [disabled, ownerLocked, ownerThreadId, threads]);
  const primaryThreadId = lockedThreadId ?? ownerThreadId;
  const primaryThread = primaryThreadId
    ? (threads.get(primaryThreadId) ?? { title: primaryThreadId, providerId: "agent", unavailable: true })
    : undefined;
  const changeOwner = async (next: string[]) => {
    if (ownerLocked) return;
    const nextOwnerThreadId = next[0] ?? null;
    const priorThreadIds = [...new Set(linkedThreadIds)];
    if (nextOwnerThreadId === ownerThreadId) {
      for (const threadId of priorThreadIds)
        await onToggle(threadId, false);
      return;
    }
    if (nextOwnerThreadId) await onToggle(nextOwnerThreadId, true);
    for (const threadId of priorThreadIds) {
      if (threadId !== nextOwnerThreadId) await onToggle(threadId, false);
    }
  };

  return (
    <span className="ws-task-thread-picker">
      <span className="ws-task-thread-chip">
        {primaryThread ? (
          primaryThread.unavailable ? (
            <span
              className="ws-task-thread-unavailable"
              aria-label={`Owner thread unavailable: ${primaryThread.title}`}
            >
              <Icon name="CircleAlert" aria-hidden />
              <span>{primaryThread.title}</span>
              <span>Owner thread unavailable</span>
            </span>
          ) : (
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
          </CopyBadge>
          )
        ) : (
          <span className="ws-task-thread-empty">
            <Icon name="GitBranch" aria-hidden />
            <span>No thread</span>
          </span>
        )}
        <ActionTooltip label={ownerLocked
          ? "This owner thread is managed by a durable Work binding."
          : `Edit threads for ${taskKey}`}>
          {(tooltipId) => <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          className="ws-task-thread-trigger"
          aria-label={`Edit threads for ${taskKey}`}
          aria-describedby={ownerLocked ? `${lockDescriptionId} ${tooltipId}` : tooltipId}
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
          >
          <Icon name="ChevronDown" aria-hidden />
          </button>}
        </ActionTooltip>
        {ownerLocked ? (
          <span id={lockDescriptionId} className="ws-sr-only">
            This owner thread is managed by a durable Work binding.
          </span>
        ) : null}
      </span>
      <SearchCombobox
        anchorRef={triggerRef}
        ariaLabel={`Search threads for ${taskKey}`}
        autoFocus
        closeOnSelect
        emptyMessage="No matching threads."
        listboxLabel={`Thread assignment for ${taskKey}`}
        onOpenChange={setOpen}
        onSelectionChange={(next) => {
          void changeOwner(next).catch(() => undefined);
        }}
        open={open}
        options={options}
        placeholder="Search threads…"
        portal
        selectedValues={ownerThreadId ? [ownerThreadId] : []}
      />
    </span>
  );
}

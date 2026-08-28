import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const optionsId = useId();
  const options = useMemo(() => {
    const available = new Map(threads);
    for (const threadId of linkedThreadIds) {
      if (!available.has(threadId))
        available.set(threadId, {
          title: threadId,
          providerId: "agent",
        });
    }
    return [...available.entries()];
  }, [linkedThreadIds, threads]);
  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return options;
    return options.filter(([, thread]) =>
      `${thread.title} ${thread.provider?.displayName ?? thread.providerId}`
        .toLocaleLowerCase()
        .includes(normalized),
    );
  }, [options, query]);
  const primaryThreadId = lockedThreadId ?? linkedThreadIds[0] ?? null;
  const primaryThread = primaryThreadId
    ? (threads.get(primaryThreadId) ??
      options.find(([threadId]) => threadId === primaryThreadId)?.[1])
    : undefined;
  const activeOption =
    activeIndex === null ? null : (visible[activeIndex] ?? null);
  const optionId = (index: number) => `${optionsId}-option-${index}`;

  useEffect(() => {
    if (!open) return;
    searchRef.current?.focus();
    const ownerDocument = rootRef.current?.ownerDocument;
    if (!ownerDocument) return;
    const dismissOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const dismissWithEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      setQuery("");
      setActiveIndex(null);
      triggerRef.current?.focus();
    };
    ownerDocument.addEventListener("pointerdown", dismissOutside, true);
    ownerDocument.addEventListener("keydown", dismissWithEscape);
    return () => {
      ownerDocument.removeEventListener("pointerdown", dismissOutside, true);
      ownerDocument.removeEventListener("keydown", dismissWithEscape);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || activeIndex === null) return;
    document
      .getElementById(optionId(activeIndex))
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open, optionsId]);

  const toggleOpen = () => {
    setOpen((current) => {
      if (!current) {
        setQuery("");
        setActiveIndex(null);
      }
      return !current;
    });
  };
  const toggleActive = () => {
    if (!activeOption) return;
    const [threadId] = activeOption;
    if (lockedThreadId === threadId || disabled) return;
    onToggle(threadId, !linkedThreadIds.includes(threadId));
  };

  return (
    <span
      className="ws-task-thread-picker"
      ref={rootRef}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (!next || !event.currentTarget.contains(next)) {
          setOpen(false);
          setQuery("");
          setActiveIndex(null);
        }
      }}
    >
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
              <span className="ws-task-thread-count">
                +{linkedThreadIds.length - 1}
              </span>
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
          onClick={toggleOpen}
        >
          <Icon name="ChevronDown" aria-hidden />
        </button>
      </span>
      {open ? (
        <span className="ws-task-thread-popover">
          <label className="ws-task-thread-search">
            <Icon name="Search" aria-hidden />
            <input
              ref={searchRef}
              value={query}
              role="combobox"
              aria-label={`Search threads for ${taskKey}`}
              aria-autocomplete="list"
              aria-expanded="true"
              aria-controls={optionsId}
              aria-activedescendant={
                activeIndex === null ? undefined : optionId(activeIndex)
              }
              placeholder="Search threads…"
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveIndex((current) =>
                    visible.length
                      ? current === null
                        ? 0
                        : Math.min(current + 1, visible.length - 1)
                      : null,
                  );
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveIndex((current) =>
                    visible.length
                      ? current === null
                        ? visible.length - 1
                        : Math.max(current - 1, 0)
                      : null,
                  );
                } else if (event.key === "Home") {
                  event.preventDefault();
                  setActiveIndex(visible.length ? 0 : null);
                } else if (event.key === "End") {
                  event.preventDefault();
                  setActiveIndex(visible.length ? visible.length - 1 : null);
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  toggleActive();
                }
              }}
            />
          </label>
          <span
            id={optionsId}
            className="ws-task-thread-options"
            role="listbox"
            aria-label={`Thread assignment for ${taskKey}`}
            aria-multiselectable="true"
          >
            {visible.length ? (
              visible.map(([threadId, thread], index) => {
                const attached = linkedThreadIds.includes(threadId);
                const locked = lockedThreadId === threadId;
                return (
                  <button
                    key={threadId}
                    id={optionId(index)}
                    type="button"
                    role="option"
                    aria-label={thread.title}
                    aria-selected={attached}
                    aria-disabled={locked || undefined}
                    data-active={activeIndex === index || undefined}
                    disabled={locked || disabled}
                    tabIndex={-1}
                    title={
                      locked ? "Owned by this task's Work binding" : undefined
                    }
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onToggle(threadId, !attached)}
                  >
                    <span aria-hidden>
                      <ThreadProviderLogo
                        providerId={thread.providerId}
                        provider={thread.provider}
                      />
                    </span>
                    <span>{thread.title}</span>
                    {attached ? <Icon name="Check" aria-hidden /> : null}
                  </button>
                );
              })
            ) : (
              <span role="option" aria-disabled="true">
                No matching threads.
              </span>
            )}
          </span>
        </span>
      ) : null}
    </span>
  );
}

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { fitContextMenuPosition } from "../../components/ui/context-menu";
import { Icon } from "../../components/ui/icon";
import { Input } from "../../components/ui/input";
import {
  usePullRequestReviewers,
  useUpdatePullRequestReviewers,
  type PullRequestRpc,
} from "./queries";
import type { PullRequestReviewerContract } from "./schemas";

function normalize(logins: readonly string[]): string[] {
  return [...new Set(logins.map((login) => login.toLocaleLowerCase()))].sort();
}

export function PullRequestReviewerPicker({
  rpc,
  repository,
  number,
  title,
  requestedReviewers,
  anchorRef,
  onClose,
}: {
  rpc: PullRequestRpc;
  repository: string;
  number: number;
  title: string;
  requestedReviewers: readonly string[];
  anchorRef: RefObject<HTMLElement | null>;
  onClose(): void;
}) {
  const headingId = useId();
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [queryText, setQueryText] = useState("");
  const [selected, setSelected] = useState<string[]>([...requestedReviewers]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState<{
    left: number;
    top: number;
  } | null>(null);
  const directory = usePullRequestReviewers(rpc, repository, true);
  const update = useUpdatePullRequestReviewers(rpc);
  const close = useCallback(() => {
    onClose();
    requestAnimationFrame(() => anchorRef.current?.focus());
  }, [anchorRef, onClose]);

  const options = useMemo(() => {
    const byLogin = new Map<string, PullRequestReviewerContract>();
    for (const reviewer of directory.data ?? [])
      byLogin.set(reviewer.login.toLocaleLowerCase(), reviewer);
    for (const login of requestedReviewers)
      if (!byLogin.has(login.toLocaleLowerCase()))
        byLogin.set(login.toLocaleLowerCase(), {
          login,
          name: null,
          avatarUrl: null,
        });
    return [...byLogin.values()].sort((left, right) =>
      left.login.localeCompare(right.login, undefined, { sensitivity: "base" }),
    );
  }, [directory.data, requestedReviewers]);
  const visible = useMemo(() => {
    const needle = queryText.trim().toLocaleLowerCase();
    return options.filter((reviewer) =>
      `${reviewer.login} ${reviewer.name ?? ""}`
        .toLocaleLowerCase()
        .includes(needle),
    );
  }, [options, queryText]);
  const dirty =
    JSON.stringify(normalize(selected)) !==
    JSON.stringify(normalize(requestedReviewers));
  const activeOptionId = visible[activeIndex]
    ? `${listId}-option-${activeIndex}`
    : undefined;

  useEffect(() => {
    rootRef.current?.querySelector("input")?.focus();
    const ownerDocument = rootRef.current?.ownerDocument ?? document;
    const dismissOutside = (event: PointerEvent) => {
      const target = event.target;
      const NodeConstructor = ownerDocument.defaultView?.Node;
      if (
        NodeConstructor &&
        target instanceof NodeConstructor &&
        !rootRef.current?.contains(target) &&
        !anchorRef.current?.contains(target)
      )
        close();
    };
    ownerDocument.addEventListener("pointerdown", dismissOutside, true);
    return () =>
      ownerDocument.removeEventListener("pointerdown", dismissOutside, true);
  }, [anchorRef, close]);

  useLayoutEffect(() => {
    if (!activeOptionId) return;
    const option =
      rootRef.current?.ownerDocument.getElementById(activeOptionId);
    if (option && "scrollIntoView" in option)
      option.scrollIntoView({ block: "nearest" });
  }, [activeOptionId]);

  useLayoutEffect(() => {
    const updatePosition = () => {
      const picker = rootRef.current?.getBoundingClientRect();
      const anchor = anchorRef.current?.getBoundingClientRect();
      if (!picker) return;
      const fitted = fitContextMenuPosition(
        { x: anchor?.left ?? 8, y: anchor?.bottom ?? 8 },
        { width: picker.width, height: picker.height },
        { width: window.innerWidth, height: window.innerHeight },
      );
      setPosition(fitted);
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    return () => window.removeEventListener("resize", updatePosition);
  }, [directory.status, visible.length]);

  const toggle = (reviewer: PullRequestReviewerContract) => {
    update.reset();
    setSelected((current) => {
      const key = reviewer.login.toLocaleLowerCase();
      const exists = current.some((login) => login.toLocaleLowerCase() === key);
      return exists
        ? current.filter((login) => login.toLocaleLowerCase() !== key)
        : [...current, reviewer.login];
    });
  };
  const save = async () => {
    try {
      await update.mutateAsync({
        repository,
        number,
        reviewers: [...selected].sort((left, right) =>
          left.localeCompare(right, undefined, { sensitivity: "base" }),
        ),
      });
      toast.success("Reviewers updated");
      close();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not update reviewers",
      );
    }
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={rootRef}
      className="ws-pr-reviewer-picker"
      role="dialog"
      aria-labelledby={headingId}
      data-portalled="true"
      style={{
        left: position?.left ?? 8,
        top: position?.top ?? 8,
        visibility: position ? undefined : "hidden",
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          close();
        }
      }}
    >
      <header>
        <span>
          <strong id={headingId}>Reviewers for PR #{number}</strong>
          <small>{title}</small>
        </span>
        <button
          type="button"
          aria-label="Close reviewer picker"
          onClick={close}
        >
          <Icon name="X" aria-hidden />
        </button>
      </header>
      <Input
        value={queryText}
        role="combobox"
        aria-label="Search reviewers"
        aria-expanded={directory.isSuccess && visible.length > 0}
        aria-controls={
          directory.isSuccess && visible.length > 0 ? listId : undefined
        }
        aria-activedescendant={activeOptionId}
        aria-autocomplete="list"
        placeholder="Search reviewers…"
        onChange={(event) => {
          setQueryText(event.target.value);
          setActiveIndex(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && visible.length) {
            event.preventDefault();
            setActiveIndex((index) => Math.min(index + 1, visible.length - 1));
          } else if (event.key === "ArrowUp" && visible.length) {
            event.preventDefault();
            setActiveIndex((index) => Math.max(index - 1, 0));
          } else if (event.key === "Enter" && visible[activeIndex]) {
            event.preventDefault();
            toggle(visible[activeIndex]);
          }
        }}
      />
      {directory.isPending ? (
        <div className="ws-pr-reviewer-state" role="status">
          Loading reviewers…
        </div>
      ) : directory.isError ? (
        <div className="ws-pr-reviewer-state" role="alert">
          <span>{directory.error.message}</span>
          <button type="button" onClick={() => void directory.refetch()}>
            Retry reviewers
          </button>
        </div>
      ) : visible.length ? (
        <div
          id={listId}
          className="ws-pr-reviewer-options"
          role="listbox"
          aria-label="Available reviewers"
          aria-multiselectable="true"
        >
          {visible.map((reviewer, index) => {
            const checked = selected.some(
              (login) =>
                login.toLocaleLowerCase() ===
                reviewer.login.toLocaleLowerCase(),
            );
            return (
              <button
                key={reviewer.login}
                id={`${listId}-option-${index}`}
                type="button"
                role="option"
                aria-selected={checked}
                tabIndex={-1}
                data-active={index === activeIndex || undefined}
                onMouseDown={(event) => event.preventDefault()}
                onPointerMove={() => setActiveIndex(index)}
                onClick={() => toggle(reviewer)}
              >
                <Icon name={checked ? "Check" : "User"} aria-hidden />
                <span>{reviewer.login}</span>
                {reviewer.name ? <small>{reviewer.name}</small> : null}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="ws-pr-reviewer-state">No matching reviewers.</div>
      )}
      {update.isError ? (
        <div className="ws-pr-reviewer-error" role="alert">
          {update.error.message}
        </div>
      ) : null}
      <footer>
        <button type="button" onClick={close} disabled={update.isPending}>
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || update.isPending || directory.isError}
        >
          {update.isPending ? "Saving…" : "Save reviewers"}
        </button>
      </footer>
    </div>,
    document.body,
  );
}

import {
  useCallback,
  createContext,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  useRpc,
  type PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../contracts";
import type { ThreadTaskLink } from "../../work-model";
import {
  createThreadHierarchyIndex,
  type HierarchyBinding,
  type HierarchyThread,
  type ThreadHierarchyCandidate,
} from "./hierarchy-model";
import { useThreadHierarchyMutation } from "./queries";

export type ThreadHierarchyPickerRequest = Readonly<{
  anchor: HTMLElement;
  anchorRect: Pick<DOMRect, "bottom" | "left" | "right" | "top">;
  onFocusReturn(): void;
  threadId: string;
  title: string;
}>;

type ThreadHierarchyContextValue = Readonly<{
  ready: boolean;
  pendingThreadId: string | null;
  picker: ThreadHierarchyPickerRequest | null;
  candidates: readonly ThreadHierarchyCandidate[];
  openPicker(request: ThreadHierarchyPickerRequest): void;
  closePicker(): void;
  move(threadId: string, parentThreadId: string | null): Promise<unknown>;
}>;

const ThreadHierarchyContext = createContext<ThreadHierarchyContextValue | null>(
  null,
);
const disabledThreadHierarchy: ThreadHierarchyContextValue = {
  ready: false,
  pendingThreadId: null,
  picker: null,
  candidates: [],
  openPicker: () => undefined,
  closePicker: () => undefined,
  move: () => Promise.reject(new Error("Thread hierarchy is unavailable.")),
};

function projectThreads(
  threads: readonly PluginSidebarThread[],
): HierarchyThread[] {
  return threads.map((thread) => ({
    id: thread.id,
    projectId: thread.projectId,
    parentThreadId: thread.parentThreadId,
    isArchived: thread.isArchived,
    title: thread.title ?? thread.titleFallback ?? "Untitled thread",
  }));
}

function rootThreadId(
  threads: ReadonlyMap<string, PluginSidebarThread>,
  threadId: string,
) {
  const visited = new Set<string>();
  let current = threads.get(threadId);
  while (current?.parentThreadId) {
    if (visited.has(current.id)) return threadId;
    visited.add(current.id);
    current = threads.get(current.parentThreadId);
  }
  return current?.id ?? threadId;
}

function projectBindings(
  threads: readonly PluginSidebarThread[],
  links: Readonly<Record<string, readonly ThreadTaskLink[]>>,
): HierarchyBinding[] {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  return Object.entries(links).flatMap(([ownerThreadId, ownerLinks]) =>
    ownerLinks.map((link) => ({
      kind: link.role,
      rootThreadId: rootThreadId(byId, ownerThreadId),
      ownerThreadId,
      taskKey: link.task.key,
    })),
  );
}

export function ThreadHierarchyProvider({
  threads,
  taskLinks,
  ready,
  children,
}: {
  threads: readonly PluginSidebarThread[];
  taskLinks: Readonly<Record<string, readonly ThreadTaskLink[]>>;
  ready: boolean;
  children: ReactNode;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const mutation = useThreadHierarchyMutation(rpc);
  const [picker, setPicker] = useState<ThreadHierarchyPickerRequest | null>(null);
  const pickerRef = useRef<ThreadHierarchyPickerRequest | null>(null);
  const projectedThreads = useMemo(() => projectThreads(threads), [threads]);
  const bindings = useMemo(
    () => projectBindings(threads, taskLinks),
    [taskLinks, threads],
  );
  const ancestry = useMemo(
    () => createThreadHierarchyIndex(projectedThreads, bindings),
    [bindings, projectedThreads],
  );
  const candidates = useMemo(
    () =>
      ready && picker
        ? ancestry.candidates(picker.threadId)
        : ([] as ThreadHierarchyCandidate[]),
    [ancestry, picker, ready],
  );
  const openPicker = useCallback((request: ThreadHierarchyPickerRequest) => {
    pickerRef.current = request;
    setPicker(request);
  }, []);
  const closePicker = useCallback(() => {
    const returnFocus = pickerRef.current?.onFocusReturn;
    pickerRef.current = null;
    setPicker(null);
    if (!returnFocus) return;
    const focus = () => returnFocus();
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(focus);
    else queueMicrotask(focus);
  }, []);
  const value = useMemo<ThreadHierarchyContextValue>(
    () => ({
      ready,
      pendingThreadId: mutation.isPending
        ? (mutation.variables?.threadId ?? null)
        : null,
      picker,
      candidates,
      openPicker,
      closePicker,
      move: (threadId, parentThreadId) =>
        mutation.mutateAsync({ threadId, parentThreadId }),
    }),
    [candidates, closePicker, mutation, openPicker, picker, ready],
  );
  return (
    <ThreadHierarchyContext.Provider value={value}>
      {children}
    </ThreadHierarchyContext.Provider>
  );
}

export function useThreadHierarchy() {
  return useContext(ThreadHierarchyContext) ?? disabledThreadHierarchy;
}

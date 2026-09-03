export type ThreadActivityState =
  | "error"
  | "blocked"
  | "attention"
  | "queued"
  | "working"
  | "done"
  | "idle";

export type ThreadActivityTone =
  | "blocked"
  | "waiting"
  | "working"
  | "complete"
  | "idle";

export type ThreadActivityIcon =
  | "AlertCircle"
  | "UserClock"
  | "MessageSquare"
  | "LoaderCircle"
  | "Check"
  | "Zzz";

export type ThreadActivityPresentation = Readonly<{
  precedence: number;
  label: "Blocked" | "Waiting" | "Queued" | "Working" | "Complete" | "Idle";
  tone: ThreadActivityTone;
  icon: ThreadActivityIcon;
}>;

/**
 * The only activity precedence and presentation matrix. Source adapters may
 * retain concurrent states, but every surface selects the first state here.
 */
export const THREAD_ACTIVITY_PRESENTATION = {
  error: {
    precedence: 0,
    label: "Blocked",
    tone: "blocked",
    icon: "AlertCircle",
  },
  blocked: {
    precedence: 1,
    label: "Blocked",
    tone: "blocked",
    icon: "AlertCircle",
  },
  attention: {
    precedence: 2,
    label: "Waiting",
    tone: "waiting",
    icon: "UserClock",
  },
  done: {
    precedence: 3,
    label: "Complete",
    tone: "complete",
    icon: "Check",
  },
  working: {
    precedence: 4,
    label: "Working",
    tone: "working",
    icon: "LoaderCircle",
  },
  queued: {
    precedence: 5,
    label: "Queued",
    tone: "waiting",
    icon: "MessageSquare",
  },
  idle: {
    precedence: 6,
    label: "Idle",
    tone: "idle",
    icon: "Zzz",
  },
} as const satisfies Record<ThreadActivityState, ThreadActivityPresentation>;

export type ThreadActivityFact = Readonly<{
  state: ThreadActivityState;
  states: readonly ThreadActivityState[];
  label: string | null;
  ownWorking: boolean;
  queuedCount: number;
  stale: boolean;
  childCount: number;
  activeChildCount: number;
}>;

type FactOptions = Readonly<{
  queuedCount?: number;
  stale?: boolean;
  childCount?: number;
  activeChildCount?: number;
}>;

export type SidebarThreadActivitySource = Readonly<{
  indicator?: string | null;
  indicatorLabel?: string | null;
  hasPendingInteraction?: boolean;
  activity?: Readonly<{
    workflows?: number;
    backgroundAgents?: number;
    backgroundCommands?: number;
    planMode?: number;
    goals?: number;
  }> | null;
}>;

export type RuntimeThreadActivitySource = Readonly<{
  status?: string | null;
  runtimeStatus?: string | null;
}>;

function orderedStates(states: Iterable<ThreadActivityState>) {
  const unique = new Set(states);
  if (unique.size === 0) unique.add("idle");
  return [...unique].sort(
    (left, right) =>
      THREAD_ACTIVITY_PRESENTATION[left].precedence -
      THREAD_ACTIVITY_PRESENTATION[right].precedence,
  );
}

function createFact(
  states: Iterable<ThreadActivityState>,
  label: string | null,
  ownWorking: boolean,
  options: FactOptions,
): ThreadActivityFact {
  const ordered = orderedStates(states);
  const state = ordered[0] ?? "idle";
  return {
    state,
    states: ordered,
    label: label ?? THREAD_ACTIVITY_PRESENTATION[state].label,
    ownWorking,
    queuedCount: Math.max(0, options.queuedCount ?? 0),
    stale: options.stale ?? false,
    childCount: Math.max(0, options.childCount ?? 0),
    activeChildCount: Math.max(0, options.activeChildCount ?? 0),
  };
}

const workingIndicators = new Set([
  "runtime",
  "workflow",
  "background-agent",
  "background-command",
  "goal",
  "plan-mode",
  "working-draft",
]);

/** Normalize the BB sidebar hook's host-owned activity signals. */
export function adaptSidebarThreadActivity(
  thread: SidebarThreadActivitySource,
  options: FactOptions = {},
): ThreadActivityFact {
  const indicator = String(thread.indicator ?? "none").toLowerCase();
  const ownWorking =
    Object.values(thread.activity ?? {}).some((count) => (count ?? 0) > 0) ||
    workingIndicators.has(indicator);
  const states: ThreadActivityState[] = [];
  if (indicator === "unread-error") states.push("error");
  if (indicator.includes("blocked") || indicator === "failed")
    states.push("blocked");
  if (
    thread.hasPendingInteraction ||
    indicator === "waiting-for-input" ||
    indicator.includes("approval")
  )
    states.push("attention");
  if ((options.queuedCount ?? 0) > 0) states.push("queued");
  if (ownWorking || (options.activeChildCount ?? 0) > 0) states.push("working");
  if (indicator === "unread-success") states.push("done");
  return createFact(
    states,
    thread.indicatorLabel?.trim() || null,
    ownWorking,
    options,
  );
}

/** Normalize the server-owned thread/runtime pair used by Work. */
export function adaptRuntimeThreadActivity(
  thread: RuntimeThreadActivitySource,
  options: FactOptions = {},
): ThreadActivityFact {
  const status = String(thread.status ?? "").toLowerCase();
  const runtimeStatus = String(thread.runtimeStatus ?? "").toLowerCase();
  const value = `${status} ${runtimeStatus}`;
  const states: ThreadActivityState[] = [];
  if (/blocked|error|failed/.test(value)) states.push("blocked");
  if (/waiting|input|approval|paused/.test(value))
    states.push("attention");
  if ((options.queuedCount ?? 0) > 0) states.push("queued");
  const ownWorking = /working|running|starting|active/.test(value);
  if (ownWorking || (options.activeChildCount ?? 0) > 0) states.push("working");
  if (!ownWorking && /complete|completed|done|finished/.test(value))
    states.push("done");
  return createFact(states, null, ownWorking, options);
}

export function threadActivityPresentation(fact: ThreadActivityFact) {
  return THREAD_ACTIVITY_PRESENTATION[fact.state];
}

/** Queue state remains visible in trailing UI without repainting the provider. */
export function threadActivityProviderState(
  fact: ThreadActivityFact,
): "idle" | "working" | "waiting" | "error" | "complete" | "stale" {
  const states = new Set(fact.states);
  if (states.has("error") || states.has("blocked")) return "error";
  // A pending interaction is an attention fact, but it must not repaint a
  // provider that is still doing work. The trailing UI remains responsible
  // for showing the concurrent attention state.
  if (states.has("working")) return "working";
  if (states.has("attention")) return "waiting";
  if (states.has("done")) return "complete";
  if (fact.stale) return "stale";
  return "idle";
}

/**
 * Roll a recursive child tree into one fact. Cycles are ignored and each
 * descendant contributes to counts at most once.
 */
export function rollupThreadActivityFacts(
  rootId: string,
  facts: ReadonlyMap<string, ThreadActivityFact>,
  childrenByThread: ReadonlyMap<string, readonly string[]>,
): ThreadActivityFact {
  return (
    rollupThreadActivityFactDirectory([rootId], facts, childrenByThread).get(
      rootId,
    ) ?? createFact([], null, false, {})
  );
}

/** Compute every requested rollup once so large thread rosters stay linear. */
export function rollupThreadActivityFactDirectory(
  threadIds: Iterable<string>,
  facts: ReadonlyMap<string, ThreadActivityFact>,
  childrenByThread: ReadonlyMap<string, readonly string[]>,
): ReadonlyMap<string, ThreadActivityFact> {
  const rollups = new Map<string, ThreadActivityFact>();
  const visiting = new Set<string>();
  const visit = (id: string): ThreadActivityFact | null => {
    const cached = rollups.get(id);
    if (cached) return cached;
    if (visiting.has(id)) return null;
    visiting.add(id);
    const root = facts.get(id) ?? createFact([], null, false, {});
    let winningFact = root;
    const states = [...root.states];
    let childCount = 0;
    let activeChildCount = 0;
    for (const childId of childrenByThread.get(id) ?? []) {
      const child = facts.get(childId);
      const childRollup = visit(childId);
      if (!childRollup || !child) continue;
      states.push(...childRollup.states);
      childCount += 1 + childRollup.childCount;
      activeChildCount +=
        (child.ownWorking ? 1 : 0) + childRollup.activeChildCount;
      if (
        THREAD_ACTIVITY_PRESENTATION[childRollup.state].precedence <
        THREAD_ACTIVITY_PRESENTATION[winningFact.state].precedence
      )
        winningFact = childRollup;
    }
    visiting.delete(id);
    const result = createFact(states, winningFact.label, root.ownWorking, {
      queuedCount: root.queuedCount,
      stale: root.stale,
      childCount,
      activeChildCount,
    });
    rollups.set(id, result);
    return result;
  };
  for (const id of threadIds) visit(id);
  return rollups;
}

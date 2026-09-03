import { useEffect, useState } from "react";
import { experimental_useProviders } from "@get-bb/plugin-sdk/app";
import { useStore } from "zustand";
import { Icon } from "../../components/ui/icon";
import { ThreadProviderLogo } from "../../components/threads/thread-provider-logo";
import { ActionTooltip } from "../../components/ui/action-tooltip";
import { useLatestActivity, useWorkProviderHealth, useWorkStatus } from "./queries";
import { CardState } from "./card-state";
import { ProviderHealth, ProviderStatusSection } from "./provider-status-section";
import { formatActivityAge } from "./latest-activity";
import { threadInteractionStore } from "../threads/store";
import {
  adaptRuntimeThreadActivity,
  threadActivityPresentation,
  type ThreadActivityFact,
} from "../../shared/thread-activity";

function countLabel(count: number, description: string) {
  return `${count} ${description}${count === 1 ? "" : "s"}`;
}

export function StatusCard({ threadId }: { threadId: string }) {
  const query = useWorkStatus(threadId);
  const latestActivity = useLatestActivity(threadId, query.data?.currentThread.status);
  const provider = useWorkProviderHealth(threadId, query.data?.currentThread);
  const providerStatusExpanded = useStore(
    threadInteractionStore,
    (state) => state.providerStatusExpandedThreadIds.has(threadId),
  );
  const providerDirectory = experimental_useProviders();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const data = query.data;
  const total = data?.children.filter((child) => !child.isArchived).length ?? 0;
  const active = data?.children.filter(
    (child) => !child.isArchived && ["active", "starting"].includes(child.status),
  ).length ?? 0;
  const activity = data
    ? adaptRuntimeThreadActivity(data.currentThread, {
        childCount: total,
        activeChildCount: active,
      })
    : null;
  const toggle = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  return (
    <CardState
      title="Status"
      className="ws-status-card"
      trailing={
        data && activity ? (
          <StatusHeading
            activity={activity}
            total={total}
            active={active}
            provider={provider.data ?? null}
            providerLogo={provider.data
              ? providerDirectory.providers.find((candidate) => candidate.id === provider.data!.providerId)
              : undefined}
          />
        ) : undefined
      }
      pending={query.isPending}
      error={query.error}
      onRetry={() => void query.refetch()}
    >
      {provider.data ? (
        <ProviderStatusSection
          provider={provider.data}
          expanded={providerStatusExpanded}
          onExpandedChange={(expanded) =>
            threadInteractionStore.getState().setProviderStatusExpanded(threadId, expanded)}
        />
      ) : null}
      {latestActivity.data?.latest || latestActivity.data?.lastUser ? (
        <div className="ws-activity-list">
          {latestActivity.data?.lastUser ? (
            <ActivityRow
              label="User"
              entry={latestActivity.data.lastUser}
              expanded={expanded.has("user")}
              onToggle={() => toggle("user")}
            />
          ) : null}
          {latestActivity.data?.latest ? (
            <ActivityRow
              label="Agent"
              entry={latestActivity.data.latest}
              expanded={expanded.has("agent")}
              onToggle={() => toggle("agent")}
            />
          ) : null}
        </div>
      ) : null}
    </CardState>
  );
}

function StatusHeading({
  activity,
  total,
  active,
  provider,
  providerLogo,
}: {
  activity: ThreadActivityFact;
  total: number;
  active: number;
  provider: Parameters<typeof ProviderHealth>[0]["provider"] | null;
  providerLogo?: Parameters<typeof ThreadProviderLogo>[0]["provider"];
}) {
  return (
    <span className="ws-status-heading-meta">
      <WorkRuntimeIndicator fact={activity} />
      <span className="ws-total-agent-count">
        <Icon name="Bot" aria-hidden />
        <span aria-hidden>{total}</span>
        <span className="ws-sr-only">{countLabel(total, "child agent")}</span>
      </span>
      <span className="ws-active-agent-count">
        <Icon name="Wrench" aria-hidden />
        <span aria-hidden>{active}</span>
        <span className="ws-sr-only">
          {countLabel(active, "active child agent")}
        </span>
      </span>
      {provider ? <ProviderHealth provider={provider} providerLogo={providerLogo} /> : null}
    </span>
  );
}

export function WorkRuntimeIndicator({ fact }: { fact: ThreadActivityFact }) {
  const presentation = threadActivityPresentation(fact);
  return (
    <ActionTooltip label={presentation.label}>
      {(tooltipId) => (
        <span
          className={`ws-runtime-state ws-runtime-state-${presentation.tone}`}
          data-thread-activity-state={fact.state}
          aria-describedby={tooltipId}
        >
          <Icon
            name={presentation.icon}
            aria-label={presentation.label}
          />
        </span>
      )}
    </ActionTooltip>
  );
}

function ActivityRow({
  label,
  entry,
  expanded,
  onToggle,
}: {
  label: "User" | "Agent";
  entry: { text: string; kind: string; createdAt?: number | null };
  expanded: boolean;
  onToggle(): void;
}) {
  return (
    <button
      type="button"
      className={`ws-activity-item${
        entry.kind === "command" ? " ws-activity-item-command" : ""
      }${expanded ? " ws-activity-item-expanded" : ""}`}
      aria-expanded={expanded}
      onClick={onToggle}
    >
      <span className="ws-activity-label">
        <Icon name={label === "User" ? "User" : "Bot"} aria-hidden />
        <span className="ws-sr-only">{label}</span>
      </span>
      {entry.kind === "command" ? (
        <code className="ws-activity-command">{entry.text}</code>
      ) : (
        <span className="ws-activity-copy">{entry.text}</span>
      )}
      <ActivityTime createdAt={entry.createdAt} />
    </button>
  );
}

function ActivityTime({ createdAt }: { createdAt?: number | null }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (createdAt == null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, [createdAt]);
  if (createdAt == null) return null;
  return (
    <time dateTime={new Date(createdAt).toISOString()}>
      {formatActivityAge(createdAt, now)}
    </time>
  );
}

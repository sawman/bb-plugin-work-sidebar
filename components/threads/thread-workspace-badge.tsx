import { CopyBadge } from "../ui/copy-badge";
import { BranchName } from "../ui/branch-name";
import { Icon } from "../ui/icon";
import { ActionTooltip } from "../ui/action-tooltip";

export type ThreadWorkspaceProject = {
  name: string;
  isPersonal: boolean;
};

type WorkspaceDisplayKind =
  | "managed-worktree"
  | "unmanaged-worktree"
  | "other";

type ThreadLocation = {
  copyLabel: "workspace name" | "worktree name" | null;
  copyValue: string | null;
  icon: "Columns2" | "FolderGit" | "Laptop";
  kind: "personal" | "repository" | "worktree";
  value: string;
};

type BranchDivergence = {
  upstream: string;
  ahead: number;
  behind: number;
};

function commitLabel(count: number) {
  return `${count} commit${count === 1 ? "" : "s"}`;
}

function BranchDivergenceIndicator({
  divergence,
}: {
  divergence?: BranchDivergence | null;
}) {
  if (!divergence || (divergence.ahead === 0 && divergence.behind === 0))
    return null;
  const details = [
    divergence.ahead > 0 ? `${divergence.ahead} ahead` : null,
    divergence.behind > 0 ? `${divergence.behind} behind` : null,
  ].filter(Boolean).join(" · ");
  const accessible = [
    divergence.ahead > 0
      ? `${commitLabel(divergence.ahead)} ahead`
      : null,
    divergence.behind > 0
      ? `${commitLabel(divergence.behind)} behind`
      : null,
  ].filter(Boolean).join(" and ");
  return (
    <ActionTooltip label={details}>
      {(tooltipId) => (
        <span
          className="ws-thread-branch-divergence"
          role="img"
          aria-label={`${accessible} ${divergence.upstream}`}
          aria-describedby={tooltipId}
          data-upstream={divergence.upstream}
        >
          {divergence.ahead > 0 ? (
            <span data-direction="ahead">↑{divergence.ahead}</span>
          ) : null}
          {divergence.behind > 0 ? (
            <span data-direction="behind">↓{divergence.behind}</span>
          ) : null}
        </span>
      )}
    </ActionTooltip>
  );
}

function fallbackLocation({
  project,
  projectLabel,
  workspace,
  workspaceDisplayKind,
}: {
  project?: ThreadWorkspaceProject;
  projectLabel: string;
  workspace: string | null;
  workspaceDisplayKind?: WorkspaceDisplayKind;
}): ThreadLocation {
  const isWorktree = workspaceDisplayKind?.includes("worktree") ?? false;
  if (isWorktree) {
    const value = workspace ?? "Detached worktree";
    return {
      copyLabel: workspace ? "worktree name" : null,
      copyValue: workspace ? `Worktree ${workspace}` : null,
      icon: "Columns2",
      kind: "worktree",
      value,
    };
  }
  const isPersonal = project?.isPersonal ?? false;
  return {
    copyLabel: workspace ? "workspace name" : null,
    copyValue: workspace ? `Workspace ${workspace}` : null,
    icon: isPersonal ? "Laptop" : "FolderGit",
    kind: isPersonal ? "personal" : "repository",
    value: workspace ?? (isPersonal ? "Personal" : projectLabel),
  };
}

export function ThreadWorkspaceBadge({
  branchName,
  environmentName,
  workspaceDisplayKind,
  project,
  projectLabel,
  divergence,
}: {
  branchName: string | null;
  environmentName?: string | null;
  workspaceDisplayKind?: WorkspaceDisplayKind;
  project?: ThreadWorkspaceProject;
  projectLabel: string;
  divergence?: BranchDivergence | null;
}) {
  const branch = branchName?.trim() || null;
  const workspace = environmentName?.trim() || null;
  if (branch) {
    return (
      <span className="ws-thread-location" data-location-kind="branch">
        <span className="ws-thread-location-content">
          <BranchName name={branch} icon="GitBranch" />
          <BranchDivergenceIndicator divergence={divergence} />
        </span>
      </span>
    );
  }
  const location = fallbackLocation({
    project,
    projectLabel,
    workspace,
    workspaceDisplayKind,
  });
  return (
    <span
      className="ws-thread-location"
      data-location-kind={location.kind}
    >
      {location.copyLabel && location.copyValue ? (
        <CopyBadge
          value={location.value}
          copyValue={location.copyValue}
          label={location.copyLabel}
          className="ws-thread-location-content"
          tooltip={false}
          typography="context"
          variant="text"
        >
          <Icon name={location.icon} aria-hidden />
          <span className="ws-thread-location-label">{location.value}</span>
        </CopyBadge>
      ) : (
        <span className="ws-thread-location-content">
          <Icon name={location.icon} aria-hidden />
          <span className="ws-thread-location-label">{location.value}</span>
        </span>
      )}
    </span>
  );
}

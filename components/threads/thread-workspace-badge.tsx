import { CopyBadge } from "../ui/copy-badge";
import { BranchName } from "../ui/branch-name";
import { Icon } from "../ui/icon";

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
}: {
  branchName: string | null;
  environmentName?: string | null;
  workspaceDisplayKind?: WorkspaceDisplayKind;
  project?: ThreadWorkspaceProject;
  projectLabel: string;
}) {
  const branch = branchName?.trim() || null;
  const workspace = environmentName?.trim() || null;
  const contextTitle = `${projectLabel} ${project?.isPersonal ? "work" : "project"}`;
  if (branch) {
    return (
      <span className="ws-thread-location" data-location-kind="branch">
        <BranchName
          name={branch}
          icon="GitBranch"
          title={`${contextTitle} · ${branch}`}
        />
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
      title={`${contextTitle} · ${location.value}`}
    >
      {location.copyLabel && location.copyValue ? (
        <CopyBadge
          value={location.value}
          copyValue={location.copyValue}
          label={location.copyLabel}
          title={`${contextTitle} · ${location.value}`}
          typography="context"
          variant="text"
        >
          <Icon name={location.icon} aria-hidden />
          <span className="ws-thread-location-label">{location.value}</span>
        </CopyBadge>
      ) : (
        <>
          <Icon name={location.icon} aria-hidden />
          <span className="ws-thread-location-label">{location.value}</span>
        </>
      )}
    </span>
  );
}

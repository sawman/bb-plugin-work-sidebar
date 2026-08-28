import { CopyBadge } from "../ui/copy-badge";
import { Icon } from "../ui/icon";

export type ThreadWorkspaceProject = {
  name: string;
  isPersonal: boolean;
};

type WorkspaceDisplayKind =
  | "managed-worktree"
  | "unmanaged-worktree"
  | "other";

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
  const value = branch ?? workspace;
  const isWorktree = workspaceDisplayKind?.includes("worktree") ?? false;
  const label = branch ? "branch name" : isWorktree ? "worktree name" : "workspace name";
  const copyValue = branch
    ? `Branch ${branch}`
    : workspace
      ? `${isWorktree ? "Worktree" : "Workspace"} ${workspace}`
      : null;
  return value && copyValue ? (
    <CopyBadge
      value={value}
      copyValue={copyValue}
      label={label}
      className="ws-thread-worktree"
      variant="text"
      title={`${projectLabel} ${project?.isPersonal ? "work" : "project"} · ${value}`}
    >
      <Icon name={project?.isPersonal ? "Laptop" : "FolderGit"} aria-hidden />
      <span>{value}</span>
    </CopyBadge>
  ) : (
    <span
      className="ws-thread-worktree"
      title={`${projectLabel} ${project?.isPersonal ? "work" : "project"} · ${project?.isPersonal ? "Personal" : projectLabel}`}
    >
      <Icon name={project?.isPersonal ? "Laptop" : "FolderGit"} aria-hidden />
      <span>{project?.isPersonal ? "Personal" : projectLabel}</span>
    </span>
  );
}

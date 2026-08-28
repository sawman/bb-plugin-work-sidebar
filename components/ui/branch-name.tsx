import { CopyBadge } from "./copy-badge";

export function BranchName({
  name,
  className,
  title,
}: {
  name: string | null;
  className?: string;
  title?: string;
}) {
  const branch = name?.trim() || null;
  if (!branch) {
    return (
      <span
        className={`ws-branch-name ws-branch-name-unavailable${className ? ` ${className}` : ""}`}
      >
        Branch unavailable
      </span>
    );
  }
  return (
    <CopyBadge
      value={branch}
      copyValue={`Branch ${branch}`}
      label="branch name"
      className={`ws-branch-name${className ? ` ${className}` : ""}`}
      variant="text"
      title={title ?? `Branch ${branch}`}
    >
      <span>{branch}</span>
    </CopyBadge>
  );
}

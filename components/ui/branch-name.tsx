import { CopyBadge } from "./copy-badge";
import { Icon, type IconName } from "./icon";

export function BranchName({
  name,
  className,
  icon,
  title,
}: {
  name: string | null;
  className?: string;
  icon?: IconName;
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
      {icon ? <Icon name={icon} aria-hidden /> : null}
      <span>{branch}</span>
    </CopyBadge>
  );
}

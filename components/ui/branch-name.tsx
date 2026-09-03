import { CopyBadge } from "./copy-badge";
import { Icon, type IconName } from "./icon";

export function BranchName({
  name,
  className,
  icon,
}: {
  name: string | null;
  className?: string;
  icon?: IconName;
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
      tooltip={false}
    >
      {icon ? <Icon name={icon} aria-hidden /> : null}
      <span>{branch}</span>
    </CopyBadge>
  );
}

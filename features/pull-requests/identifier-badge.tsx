import { CopyBadge } from "../../components/ui/copy-badge";
import { Icon } from "../../components/ui/icon";

type PullRequestIdentifier =
  | { kind: "pull-request"; number: number }
  | { kind: "branch"; name: string };

export function PullRequestIdentifierBadge(
  identifier: PullRequestIdentifier,
) {
  const pullRequest = identifier.kind === "pull-request";
  const value = pullRequest ? `#${identifier.number}` : identifier.name;
  const label = pullRequest ? "PR number" : "branch name";
  const copyValue = pullRequest ? `PR ${value}` : `Branch ${value}`;

  return (
    <CopyBadge
      value={value}
      copyValue={copyValue}
      label={label}
      className="ws-pr-identifier-badge"
      variant={pullRequest ? "badge" : "text"}
      title={copyValue}
    >
      <Icon name={pullRequest ? "GitPullRequest" : "GitBranch"} aria-hidden />
      <span>{value}</span>
    </CopyBadge>
  );
}

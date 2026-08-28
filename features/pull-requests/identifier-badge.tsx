import { BranchName } from "../../components/ui/branch-name";
import { CopyBadge } from "../../components/ui/copy-badge";
import { Icon } from "../../components/ui/icon";

type PullRequestIdentifier =
  | { kind: "pull-request"; number: number }
  | { kind: "branch"; name: string };

export function PullRequestIdentifierBadge(
  identifier: PullRequestIdentifier,
) {
  if (identifier.kind === "branch") {
    return (
      <BranchName
        name={identifier.name}
        className="ws-pr-identifier-badge"
      />
    );
  }
  const value = `#${identifier.number}`;

  return (
    <CopyBadge
      value={value}
      copyValue={`PR ${value}`}
      label="PR number"
      className="ws-pr-identifier-badge"
      title={`PR ${value}`}
    >
      <Icon name="GitPullRequest" aria-hidden />
      <span>{value}</span>
    </CopyBadge>
  );
}

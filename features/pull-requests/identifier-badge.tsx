import type { HTMLAttributes } from "react";
import { BranchName } from "../../components/ui/branch-name";
import { CopyBadge } from "../../components/ui/copy-badge";
import { Icon } from "../../components/ui/icon";
import type { StatusPresentation } from "../../components/ui/status";

type PullRequestIdentifier =
  | {
      kind: "pull-request";
      number: number;
      presentation?: StatusPresentation;
    }
  | { kind: "branch"; name: string };

type PullRequestIdentifierProps = PullRequestIdentifier & {
  onContextMenu?: HTMLAttributes<HTMLSpanElement>["onContextMenu"];
  onKeyDown?: HTMLAttributes<HTMLSpanElement>["onKeyDown"];
};

export function PullRequestIdentifierBadge(
  identifier: PullRequestIdentifierProps,
) {
  if (identifier.kind === "branch") {
    return (
      <BranchName name={identifier.name} className="ws-pr-identifier-badge" />
    );
  }
  const value = `#${identifier.number}`;
  const stateLabel = identifier.presentation?.label;

  return (
    <CopyBadge
      value={value}
      copyValue={`PR ${value}`}
      label="PR number"
      className="ws-pr-identifier-badge ws-pr-number-badge"
      title={stateLabel ?? "Pull request"}
      tone={identifier.presentation?.tone}
      aria-haspopup={identifier.onContextMenu ? "menu" : undefined}
      onContextMenu={identifier.onContextMenu}
      onKeyDown={identifier.onKeyDown}
    >
      <Icon
        name={identifier.presentation?.icon ?? "GitPullRequest"}
        data-motion={
          identifier.presentation?.icon === "LoaderCircle" ? "spin" : undefined
        }
        aria-hidden
      />
      <span>{value}</span>
    </CopyBadge>
  );
}

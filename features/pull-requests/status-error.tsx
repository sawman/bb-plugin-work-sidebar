import { SidebarListIconButton } from "../../components/ui/sidebar-list-actions";
import { Icon } from "../../components/ui/icon";
import { Status, type StatusPresentation } from "../../components/ui/status";

const unavailablePresentation: StatusPresentation = {
  icon: "AlertCircle",
  label: "Pull request unavailable",
  tone: "warning",
};

export function PullRequestReadError({ message, onRetry }: {
  message: string;
  onRetry?(): void;
}) {
  const retry = onRetry ? (
    <SidebarListIconButton title="Retry PR status" aria-label="Retry pull request status"
      onClick={(event) => { event.preventDefault(); event.stopPropagation(); onRetry(); }}>
      <Icon name="RefreshCw" aria-hidden />
    </SidebarListIconButton>
  ) : null;
  return <div className="ws-callout" role="alert">Pull request unavailable: {message} {retry}</div>;
}

/** Thread rows only mark the failure; the Threads toolbar refresh is the retry. */
export function PullRequestUnavailableStatus() {
  return <Status presentation={unavailablePresentation} size="metadata" />;
}

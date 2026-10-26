import { SidebarListIconButton } from "../../components/ui/sidebar-list-actions";
import { Icon } from "../../components/ui/icon";

export function PullRequestReadError({ message, onRetry, compact = false }: {
  message: string;
  onRetry?(): void;
  compact?: boolean;
}) {
  const retry = onRetry ? (
    <SidebarListIconButton title="Retry PR status" aria-label="Retry pull request status"
      onClick={(event) => { event.preventDefault(); event.stopPropagation(); onRetry(); }}>
      <Icon name="RefreshCw" aria-hidden />
    </SidebarListIconButton>
  ) : null;
  return compact ? (
    <span className="ws-pr-meta" role="status" aria-label={`Pull request unavailable: ${message}`}>
      PR unavailable {retry}
    </span>
  ) : (
    <div className="ws-callout" role="alert">Pull request unavailable: {message} {retry}</div>
  );
}

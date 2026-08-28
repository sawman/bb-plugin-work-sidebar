import { Status, type StatusPresentation } from "../../components/ui/status";
import type { BackgroundJobStatus } from "./schemas";
import { CardState } from "./card-state";
import { useWorkBackgroundJobs } from "./queries";

const backgroundStatus: Record<BackgroundJobStatus, StatusPresentation> = {
  completed: { icon: "Check", label: "Completed", tone: "success" },
  failed: { icon: "AlertCircle", label: "Failed", tone: "destructive" },
  killed: { icon: "X", label: "Killed", tone: "destructive" },
  paused: { icon: "Circle", label: "Paused", tone: "warning" },
  pending: { icon: "UserClock", label: "Pending", tone: "muted" },
  running: { icon: "LoaderCircle", label: "Running", tone: "warning" },
  stopped: { icon: "Circle", label: "Stopped", tone: "muted" },
};

function backgroundJobMetadata(job: {
  kind: "command" | "workflow";
  taskType: string;
  model: string | null;
  detail: string | null;
}) {
  return [
    job.detail,
    job.kind === "workflow" ? "Workflow" : job.taskType,
    job.model,
  ]
    .filter(Boolean)
    .join(" · ");
}

export function BackgroundJobsCard({ threadId }: { threadId: string }) {
  const query = useWorkBackgroundJobs(threadId);
  const items = query.data?.items ?? [];
  return (
    <CardState
      title="Background"
      trailing={
        query.data ? (
          <span>
            <span aria-hidden>{items.length}</span>
            <span className="ws-sr-only">
              {items.length} provider background {items.length === 1 ? "job" : "jobs"}
            </span>
          </span>
        ) : undefined
      }
      pending={query.isPending}
      error={query.error}
      onRetry={() => void query.refetch()}
    >
      {items.length === 0 ? (
        <p className="ws-card-note">No provider background jobs</p>
      ) : (
        <ul className="ws-work-card-list ws-background-job-list">
          {items.map((job) => {
            const presentation = backgroundStatus[job.status];
            return (
              <li key={job.id} className="ws-work-card-row">
                <Status presentation={presentation} />
                <span className="ws-work-card-copy">
                  <strong>{job.title}</strong>
                  <small>{backgroundJobMetadata(job)}</small>
                </span>
                <small className="ws-background-job-state" aria-hidden>
                  {presentation.label}
                </small>
              </li>
            );
          })}
        </ul>
      )}
    </CardState>
  );
}

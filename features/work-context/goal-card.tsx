import { goalProgressPercent } from "../../work-model";
import { useWorkGoal } from "./queries";
import { CardState } from "./card-state";

export function GoalCard({ threadId }: { threadId: string }) {
  const query = useWorkGoal(threadId);
  const percent = query.data ? goalProgressPercent(query.data) : null;
  return (
    <CardState
      title="Goal"
      pending={query.isPending}
      error={query.error}
      onRetry={() => void query.refetch()}
    >
      {query.data ? (
        <>
          <p className="ws-card-content">{query.data.objective}</p>
          {percent !== null ? (
            <div
              className="ws-progress"
              role="progressbar"
              aria-label="Goal token usage"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
            >
              <span style={{ width: `${percent}%` }} />
            </div>
          ) : null}
        </>
      ) : (
        <p className="ws-card-note">No goal supplied by this harness.</p>
      )}
    </CardState>
  );
}

import { readableStatus } from "../../work-model";
import { useWorkPlan } from "./queries";
import { CardState } from "./card-state";

export function PlanCard({ threadId }: { threadId: string }) {
  const query = useWorkPlan(threadId);
  return (
    <CardState
      title="Plan"
      pending={query.isPending}
      error={query.error}
      onRetry={() => void query.refetch()}
    >
      {query.data?.items.length ? (
        <div className="ws-plan">
          {query.data.items.map((item) => (
            <div key={item.id} className={`ws-plan-item ws-plan-${item.status}`}>
              <span aria-hidden="true">
                {item.status === "completed" ? "✓" : item.status === "in_progress" ? "●" : "○"}
              </span>
              <span>{item.text}</span>
              <span className="ws-sr-only">{readableStatus(item.status)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="ws-card-note">No plan supplied by this harness.</p>
      )}
    </CardState>
  );
}

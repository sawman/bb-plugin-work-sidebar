export type WorkContextReadDependencies<Status, Outcome, Goal, Plan> = {
  readStatus(threadId: string): Promise<Status>;
  readOutcome(threadId: string): Promise<Outcome>;
  readGoal(threadId: string): Promise<Goal>;
  readPlan(threadId: string): Promise<Plan>;
};

/** Injectable boundary that keeps each card endpoint from reaching aggregate reads. */
export function createWorkContextReadService<Status, Outcome, Goal, Plan>(
  dependencies: WorkContextReadDependencies<Status, Outcome, Goal, Plan>,
) {
  return {
    status: (threadId: string) => dependencies.readStatus(threadId),
    outcome: (threadId: string) => dependencies.readOutcome(threadId),
    goal: (threadId: string) => dependencies.readGoal(threadId),
    plan: (threadId: string) => dependencies.readPlan(threadId),
  };
}

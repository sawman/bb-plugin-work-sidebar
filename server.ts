import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { rpcContract } from "./contracts.js";
import { createAgentRegistration } from "./features/agents/server-registration.js";
import { createChangesRegistration } from "./features/changes/server-registration.js";
import { createPullRequestRegistration, fetchGitHubStack } from "./features/pull-requests/server-registration.js";
import { createTasksRegistration, WORK_AGENT_INSTRUCTIONS } from "./features/tasks/server-registration.js";
import { createThreadRegistration } from "./features/threads/server-registration.js";
import { registerRecycleBinExpiryRoute } from "./features/threads/recycle-bin-http.js";
import { createTrackerRegistration } from "./features/tracker/server-registration.js";
import { createWorkContextRegistration } from "./features/work-context/server-registration.js";
import { createServerLifecycle, type ServerLifecycle } from "./server-lifecycle.js";
import type { ServerCompositionDependencies } from "./shared/server-composition-dependencies.js";

/** Server entrypoint: lifecycle ownership plus feature registration only. */
export default function plugin(
  bb: BbPluginApi,
  lifecycle: ServerLifecycle = createServerLifecycle(),
) {
  bb.onDispose(() => lifecycle.dispose());
  const tasks = createTasksRegistration(bb, lifecycle);
  const agents = createAgentRegistration(bb);
  const pullRequests = createPullRequestRegistration(bb, lifecycle);
  const dependencies: ServerCompositionDependencies = { bb, lifecycle, pullRequests, tasks };
  const changes = createChangesRegistration(dependencies);
  const threads = createThreadRegistration(bb, tasks);
  registerRecycleBinExpiryRoute(bb, threads.expireRecycleBinThreads);
  const workContext = createWorkContextRegistration(dependencies);
  const tracker = createTrackerRegistration(dependencies);
  bb.rpc.register(rpcContract, {
    getAgentDetails: agents.getAgentDetails,
    getChanges: changes.getChanges,
    getChangesFingerprint: changes.getChangesFingerprint,
    checkoutStackBranch: changes.checkoutStackBranch,
    getWorkingTreeFileDiff: changes.getWorkingTreeFileDiff,
    getPullRequestFileDiff: changes.getPullRequestFileDiff,
    getSidebarOrder: threads.getSidebarOrder,
    saveSiblingOrder: threads.saveSiblingOrder,
    getLaterThreads: threads.getLaterThreads,
    saveLaterThreads: threads.saveLaterThreads,
    getThreadGroups: threads.getThreadGroups,
    saveThreadGroups: threads.saveThreadGroups,
    getSidebarAppearance: threads.getSidebarAppearance,
    saveSidebarAppearance: threads.saveSidebarAppearance,
    moveSidebarThread: threads.moveSidebarThread,
    sidebarQueuedMessages: threads.sidebarQueuedMessages,
    sidebarTasks: tasks.sidebarTasks,
    sidebarTaskLinks: tasks.sidebarTaskLinks,
    sidebarThreadPullRequests: pullRequests.sidebarThreadPullRequests,
    sidebarAuthoredPullRequests: pullRequests.sidebarAuthoredPullRequests,
    sidebarAuthoredPullRequestStacks:
      pullRequests.sidebarAuthoredPullRequestStacks,
    setAuthoredPullRequestDraft: pullRequests.setAuthoredPullRequestDraft,
    getPullRequestReviewers: pullRequests.getPullRequestReviewers,
    updatePullRequestReviewers: pullRequests.updatePullRequestReviewers,
    getRecycleBin: threads.getRecycleBin,
    binSidebarThread: threads.binSidebarThread,
    restoreBinnedSidebarThread: threads.restoreBinnedSidebarThread,
    expireRecycleBinThreads: threads.expireRecycleBinThreads,
    sidebarArchivedThreads: threads.sidebarArchivedThreads,
    unarchiveSidebarThread: threads.unarchiveSidebarThread,
    getWorkContext: workContext.getWorkContext,
    getWorkStatus: workContext.getWorkStatus,
    getWorkOutcome: workContext.getWorkOutcome,
    getWorkGoal: workContext.getWorkGoal,
    getWorkPlan: workContext.getWorkPlan,
    getWorkItemQueue: workContext.getWorkItemQueue,
    saveWorkItemQueue: workContext.saveWorkItemQueue,
    moveWorkItemToExecution: workContext.moveWorkItemToExecution,
    getWorkBackgroundJobs: workContext.getWorkBackgroundJobs,
    getGitHubPollingPolicy: pullRequests.getGitHubPollingPolicy,
    getWorkTracker: tracker.getWorkTracker,
    linkLinearIssue: tracker.linkLinearIssue,
    searchLinearIssues: tracker.searchLinearIssues,
    unlinkLinearIssue: tracker.unlinkLinearIssue,
    setPrimaryLinearIssue: tracker.setPrimaryLinearIssue,
    updateLinearIssueStatus: tracker.updateLinearIssueStatus,
    getWorkProviderStatus: workContext.getWorkProviderStatus,
    getGitHubApiHealth: pullRequests.getGitHubApiHealth,
    getLatestActivity: workContext.getLatestActivity,
    createWorkTask: tasks.createWorkTask,
    ensureOutcomeContext: tasks.ensureOutcomeContext,
    createExecutionTask: tasks.createExecutionTask,
    bindExecutionOwner: tasks.bindExecutionOwner,
    adoptLegacyOutcome: tasks.adoptLegacyOutcome,
    updateTaskStatus: tasks.updateTaskStatus,
    updateTaskAssignee: tasks.updateTaskAssignee,
    createSidebarTask: tasks.createSidebarTask,
    deleteSidebarTask: tasks.deleteSidebarTask,
    attachTaskToThread: tasks.attachTaskToThread,
    detachTaskFromThread: tasks.detachTaskFromThread,
    reorderTask: tasks.reorderTask,
  });
  tasks.registerTools();
  bb.agents.configure(() => ({
    tools: ["get_sidebar_tasks", "get_task", "update_task", "comment_task", "get_work_context", "create_work_task", "create_execution_task",
      "bind_execution_owner"],
    skills: [],
    instructions: WORK_AGENT_INSTRUCTIONS,
  }));
}
export { fetchGitHubStack, createServerLifecycle, rpcContract };

type WorkflowDefinition = Record<string, readonly string[]>;

const WORKFLOW_TRANSITIONS = {
  expense: {
    submitted: ["approved", "rejected"],
  },
  leaveRequest: {
    pending: ["approved", "rejected"],
  },
  preApprovalSubmission: {
    draft: ["submitted"],
    changes_requested: ["submitted"],
  },
  preApprovalApproval: {
    submitted: ["approved", "changes_requested"],
  },
  timesheetSubmission: {
    draft: ["submitted"],
    rejected: ["submitted"],
  },
  timesheetReview: {
    submitted: ["approved", "rejected"],
  },
  timesheetPartialSubmission: {
    none: ["submitted"],
    rejected: ["submitted"],
  },
  timesheetPartialReview: {
    submitted: ["approved", "rejected"],
  },
} satisfies Record<string, WorkflowDefinition>;

export type WorkflowName = keyof typeof WORKFLOW_TRANSITIONS;

export class WorkflowStateError extends Error {
  workflow: WorkflowName;
  currentState: string;
  nextState: string;

  constructor(workflow: WorkflowName, currentState: string, nextState: string, message: string) {
    super(message);
    this.workflow = workflow;
    this.currentState = currentState;
    this.nextState = nextState;
  }
}

function allowedTargets(workflow: WorkflowName, currentState: string) {
  const transitions = WORKFLOW_TRANSITIONS[workflow] as WorkflowDefinition;
  return transitions[currentState] ?? [];
}

export function isAllowedWorkflowTransition(workflow: WorkflowName, currentState: string, nextState: string) {
  return allowedTargets(workflow, currentState).includes(nextState);
}

export function formatWorkflowTransitionError(workflow: WorkflowName, currentState: string, nextState: string) {
  const allowed = allowedTargets(workflow, currentState);
  if (allowed.length === 0) {
    return `Cannot move ${workflow} from ${currentState} to ${nextState}.`;
  }

  if (allowed.length === 1) {
    return `Cannot move ${workflow} from ${currentState} to ${nextState}. Allowed next state is ${allowed[0]}.`;
  }

  return `Cannot move ${workflow} from ${currentState} to ${nextState}. Allowed next states are ${allowed.join(", ")}.`;
}

export function assertWorkflowTransition(workflow: WorkflowName, currentState: string, nextState: string) {
  if (isAllowedWorkflowTransition(workflow, currentState, nextState)) {
    return;
  }

  throw new WorkflowStateError(workflow, currentState, nextState, formatWorkflowTransitionError(workflow, currentState, nextState));
}

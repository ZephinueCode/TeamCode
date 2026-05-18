/**
 * Committee Protocol — state machine and type definitions.
 *
 * Agent hierarchy:
 *   PM (primary)   — user-facing, planning, reviewing, final authority
 *   Coder (peer)   — autonomous code generation, plan review, execution
 *   Intern (sub)    — fast lightweight tasks (summarization, analysis)
 *
 * Coder is NOT a subagent — it has independent visibility in the TUI
 * and autonomous authority to push back on PM plans and initiate changes.
 */

// ─── Committee state machine ───

export type CommitteePhase =
  | "idle"               // waiting for user input
  | "pm_planning"        // PM generates plan
  | "coder_review"       // Coder reviews plan autonomously
  | "deliberation"       // PM ↔ Coder debate loop
  | "awaiting_approval"  // consensus reached, user confirms
  | "awaiting_decision"  // stalemate, user breaks tie
  | "executing"          // Coder writes code, PM reviews async
  | "intern_task"        // Intern dispatched for background work

export const transitions: Record<CommitteePhase, CommitteePhase[]> = {
  idle:               ["pm_planning", "intern_task"],
  pm_planning:        ["coder_review", "idle"],
  coder_review:       ["deliberation", "awaiting_approval", "pm_planning"],
  deliberation:       ["deliberation", "awaiting_approval", "awaiting_decision"],
  awaiting_approval:  ["executing", "pm_planning", "idle"],
  awaiting_decision:  ["executing", "pm_planning", "idle"],
  executing:          ["executing", "idle", "pm_planning"],
  intern_task:        ["idle", "pm_planning", "coder_review", "executing"],
}

// ─── Artifacts ───

export interface PlanArtifact {
  summary: string
  approach: string
  files: Array<{ path: string; action: "create" | "modify" | "delete"; description: string }>
  acceptanceCriteria?: string[]
  verification?: string[]
  risks: string[]
  alternatives: Array<{ description: string; pros: string[]; cons: string[] }>
  // The PM can request specific Intern tasks as part of the plan
  internTasks?: Array<{ description: string; type: "summarize" | "analyze" | "research" }>
}

export interface ReviewArtifact {
  overall: "agree" | "agree_with_changes" | "disagree"
  comments: Array<{ topic: string; opinion: string; severity: "blocker" | "suggestion" }>
  suggestedChanges: Array<{ section: string; change: string; reason: string }>
  // Coder can autonomously propose Intern tasks
  internRequests?: Array<{ description: string; urgency: "before_execution" | "during_execution" }>
}

export interface DeliberationTurn {
  round: number
  role: "pm" | "coder"
  statement: string
  concessions: string[]
  openIssues: string[]
}

// Coder execution progress — visible in TUI
export interface CoderProgress {
  currentFile: string | null
  completedFiles: string[]
  failedFiles: string[]
  pmFeedback: Array<{ file: string; feedback: string; resolved: boolean }>
  internTasks: Array<{ task: string; status: "pending" | "running" | "done" }>
}

// ─── Consensus detection ───

export type ConsensusResult = "consensus" | "minor_diff" | "stalemate"

export function detectConsensus(review: ReviewArtifact): ConsensusResult {
  if (review.overall === "agree") return "consensus"
  if (review.overall === "agree_with_changes" && !review.comments.some((c) => c.severity === "blocker")) {
    return "minor_diff"
  }
  return "stalemate"
}

export function nextPhase(
  current: CommitteePhase,
  decision: "proceed" | "consensus" | "stalemate" | "approve" | "revise" | "done",
): CommitteePhase {
  const map: Record<string, Record<string, CommitteePhase>> = {
    pm_planning:       { proceed: "coder_review" },
    coder_review:      { consensus: "awaiting_approval", stalemate: "deliberation", revise: "pm_planning" },
    deliberation:      { consensus: "awaiting_approval", stalemate: "awaiting_decision" },
    awaiting_approval: { approve: "executing", revise: "pm_planning" },
    awaiting_decision: { approve: "executing", revise: "pm_planning" },
    executing:         { done: "idle" },
  }
  return map[current]?.[decision] ?? current
}

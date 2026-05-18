/**
 * TUI state — what gets rendered, not how.
 *
 * The renderer reads this state tree and paints the terminal.
 * CommitteeController writes to it. They communicate through
 * a shared SynchronizedRef, so updates are atomic and the
 * render loop never sees half-written state.
 */
import type { CommitteePhase, CoderProgress, PlanArtifact, ReviewArtifact } from "../committee/protocol"

// ── Streaming status for live indicators ──

export type StreamStatus =
  | { kind: "idle" }
  | { kind: "streaming"; agent: "pm" | "coder" | "intern"; started: number }
  | { kind: "tool-running"; agent: "pm" | "coder" | "intern"; tool: string; since: number }

// ── A single line in the PM conversation ──

export interface ChatLine {
  id: string
  role: "user" | "pm" | "system"
  text: string
  timestamp: number
  phase?: CommitteePhase // which phase this message was sent in
}

// ── A single entry in the Coder activity feed ──

export interface ActivityEntry {
  id: string
  type: "tool-call" | "file-change" | "pm-review" | "phase-enter" | "intern-dispatch" | "compaction" | "error"
  icon: string // emoji or nerd font icon
  label: string
  detail?: string
  status: "running" | "done" | "error"
  timestamp: number
  agent: "pm" | "coder" | "intern" | "system"
}

// ── The full TUI state tree ──

export interface TuiState {
  // Header
  phase: CommitteePhase
  phaseEntered: number
  round: number
  maxRounds: number

  // Models
  pmModel: string
  coderModel: string
  internModel?: string

  // PM conversation
  chat: ChatLine[]

  // Coder activity feed
  activity: ActivityEntry[]

  // Coder progress (file-level)
  progress: CoderProgress

  // Current stream status (drives spinners)
  stream: StreamStatus

  // Plan / Review artifacts
  currentPlan?: PlanArtifact
  currentReview?: ReviewArtifact

  // Compaction visibility
  lastCompactionAt?: number
  compactionCount: number
  compactionBeforeTokens?: number
  compactionAfterTokens?: number

  // Token usage (updated in real-time)
  tokenUsage: number
  totalCost: number

  // Context window limit
  contextLimit: number

  // Input area
  inputDraft: string
  inputPlaceholder: string

  // Theme reference
  theme?: string

  // Agent personality styles
  styles?: Record<"pm" | "coder" | "intern", "fast" | "balanced" | "cautious">
}

export function initial(): TuiState {
  return {
    phase: "idle",
    phaseEntered: Date.now(),
    round: 0,
    maxRounds: 3,
    pmModel: "",
    coderModel: "",
    chat: [],
    activity: [],
    progress: { currentFile: null, completedFiles: [], failedFiles: [], pmFeedback: [], internTasks: [] },
    stream: { kind: "idle" },
    compactionCount: 0,
    tokenUsage: 0,
    totalCost: 0,
    contextLimit: 200000,
    inputDraft: "",
    inputPlaceholder: "Type a message or /command...",
  }
}

// ── The phase determines the layout ──

export type LayoutMode =
  | "chat-only"           // IDLE: full screen PM conversation
  | "chat-with-feed"      // PM_PLANNING, CODER_REVIEW, DELIBERATION: split, feed shows plan/review progress
  | "execution-split"     // EXECUTING: larger Coder feed area, file progress bar
  | "decision-modal"      // AWAITING_APPROVAL, AWAITING_DECISION: plan detail modal over chat

export function layoutMode(phase: CommitteePhase): LayoutMode {
  switch (phase) {
    case "idle":
    case "intern_task":
      return "chat-only"
    case "pm_planning":
    case "coder_review":
    case "deliberation":
      return "chat-with-feed"
    case "executing":
      return "execution-split"
    case "awaiting_approval":
    case "awaiting_decision":
      return "decision-modal"
  }
}

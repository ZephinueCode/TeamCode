/**
 * Committee-aware compaction.
 *
 * Produces a single unified summary from the PM's perspective — the Coder
 * compactions were redundant (PM already sees both sides) and doubled the
 * compaction cost. The output covers:
 *
 *   1. Conversation summary — what the user wants, what was discussed
 *   2. Plan / code state — files touched, decisions made
 *   3. Pending items — what still needs to happen
 *
 * The compaction agent receives actual recent conversation messages so it
 * can produce a useful summary regardless of phase (chat, planning, execution).
 */

import type { PlanArtifact, ReviewArtifact, CommitteePhase } from "./protocol"

// ─── Unified compaction template ───

export const COMPACTION_TEMPLATE = `Output exactly the structure below. Keep it terse — bullets, not prose.

## What Happened
- [1-3 lines: what the user asked for and what the PM did about it]

## Current State
- Plan: [plan summary if one exists, otherwise "(no plan yet)"]
- Files touched: [list or "(none)"]
- Phase: [current committee phase]

## Key Decisions
- [decision]: [why]
(if none, write "(no decisions yet)")

## Pending
- [next action or open question]
(if nothing pending, write "(nothing pending)")

## Critical Context
- [any identifiers, paths, constraints, or user preferences that MUST survive compaction]
(if none, write "(none)")`

// ─── Compaction artifact ───

export interface CommitteeCompaction {
  id: string
  sessionID: string
  summary: string
  tokenCount: number
  createdAt: number
}

// ─── Builder — feeds the PM real conversation messages ───

export interface CompactionInput {
  plan: PlanArtifact | undefined
  review: ReviewArtifact | undefined
  currentPhase: CommitteePhase
  completedFiles: string[]
  failedFiles: string[]
  pmMessages: any[]
  coderMessages: any[]
}

// Strip tool results from message content — keep tool call intent but drop
// verbose output (code blocks, file contents, grep results) that wastes
// compaction context without adding understanding.
function cleanForCompaction(content: string): string {
  let c = content
  // Strip fenced code blocks entirely
  c = c.replace(/```[\s\S]*?```/g, "[code block removed]")
  // Strip inline code spans longer than 80 chars (likely tool output)
  c = c.replace(/`[^`]{80,}`/g, "[long inline code removed]")
  // Collapse 3+ consecutive newlines into 2
  c = c.replace(/\n{3,}/g, "\n\n")
  // Strip lines that look like file content dumps (start with line numbers)
  c = c.replace(/(?:^|\n)\s*\d+\s*\|[^\n]*/g, "")
  // Strip grep/find result blocks (lines starting with common output patterns)
  c = c.replace(/(?:^|\n)(?:●|✓|✗|🔧|⚡)\s[^\n]*/g, "")
  return c.trim()
}

export function buildCompactionPrompt(
  role: "pm" | "coder",
  input: CompactionInput,
): string {
  // Feed recent conversation — clean tool results, keep tool call intent
  const recentMessages = input.pmMessages.slice(-8)
  const conversationText = recentMessages
    .map((m: any) => {
      const role = m.role === "user" ? "User" : "PM"
      const content = typeof m.content === "string" ? m.content : JSON.stringify(m.content)
      const cleaned = cleanForCompaction(content)
      const truncated = cleaned.length > 2000 ? cleaned.slice(0, 2000) + "…" : cleaned
      return `${role}: ${truncated}`
    })
    .join("\n")

  const prompt = [
    "You are the PM agent performing context compaction. Below is the recent conversation between the user and you (the PM). Summarize it so a future instance of yourself can pick up where you left off.",
    "",
    "### Recent Conversation",
    conversationText || "(no messages yet)",
    "",
    "### Current State",
    "Phase: " + input.currentPhase,
    input.plan ? `Plan: ${input.plan.summary}` : "Plan: (no plan yet)",
    "Completed files: " + (input.completedFiles.length ? input.completedFiles.join(", ") : "(none)"),
    input.failedFiles.length ? "Failed files: " + input.failedFiles.join(", ") : "",
    input.review ? `Review verdict: ${input.review.overall}` : "",
    "",
    "### Template",
    COMPACTION_TEMPLATE,
  ]

  return prompt.filter((l) => l !== "").join("\n")
}

// ─── Single-agent compaction (only PM runs) ───

export function parseCompaction(text: string): CommitteeCompaction {
  return {
    id: crypto.randomUUID(),
    sessionID: "",
    summary: text,
    tokenCount: Math.ceil(text.length / 3.5),
    createdAt: Date.now(),
  }
}

// Kept for backward compatibility — now just returns the PM output as-is
export function mergeCompactions(
  pmOutput: string,
  _coderOutput: string,
  sessionID: string,
): CommitteeCompaction {
  return {
    id: crypto.randomUUID(),
    sessionID,
    summary: pmOutput,
    tokenCount: Math.ceil(pmOutput.length / 3.5),
    createdAt: Date.now(),
  }
}

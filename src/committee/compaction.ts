/**
 * Committee-aware compaction.
 *
 * Unlike single-agent compaction, committee sessions involve three perspectives.
 * We produce a 3-part compaction artifact:
 *
 *   1. Shared Consensus  — agreed decisions, plan status, next actions
 *   2. PM Context         — user requirements, design rationale, pending feedback
 *   3. Coder Context      — files modified, implementation notes, technical debt
 *
 * This allows each agent to restore its own mental model while sharing
 * the common ground needed for coordination.
 */

import type { PlanArtifact, ReviewArtifact, CommitteePhase } from "./protocol"

// ─── The 3-part compaction template ───

export const COMPACTION_TEMPLATE = `Output exactly the structure shown inside <template>. Do NOT include the <template> tags.

<template>
## Shared Consensus
<!-- Both PM and Coder agree on these points. This section is authoritative. -->
### Agreed Approach
- [approach summary that both agents committed to]

### Plan Status
- Completed files: [list or "(none)"]
- In progress: [current file or "(none)"]
- Pending: [remaining files]

### Key Decisions
- [decision]: [rationale agreed by both agents]

### Open Questions
- [question]: [status — awaiting user / under investigation]

## PM Context
<!-- PM's private context: user intent, design reasoning, risk awareness -->
### User Requirements
- [distilled requirements from user messages]

### Design Rationale
- [why the agreed approach was chosen over alternatives]

### Risk Register
- [risk]: [mitigation status — handled / monitoring / unresolved]

### Pending User Feedback
- [question asked of user, awaiting response — or "(none)"]

## Coder Context
<!-- Coder's private context: implementation state, technical details, debt -->
### Files Modified
- [path]: [change summary, lines changed]

### Implementation Notes
- [non-obvious implementation details, workarounds, constraints]

### Edge Cases Handled
- [edge case]: [how it's handled]

### Technical Debt Introduced
- [debt item]: [reason — "speed", "awaiting decision", "deferred"]
</template>

Rules:
- Keep every section, even when empty. Write "(none)" for empty sections.
- Use terse bullets, not prose.
- Preserve exact file paths, error strings, and identifiers.
- Do NOT mention this compaction process in the output.
- The Shared Consensus section must ONLY contain what both agents explicitly agreed to.`

// ─── Compaction artifact ───

export interface CommitteeCompaction {
  id: string
  sessionID: string
  sharedConsensus: string
  pmContext: string
  coderContext: string
  tokenCount: number
  createdAt: number
}

// ─── Builder — constructs the prompts for each agent ───

export interface CompactionInput {
  plan: PlanArtifact | undefined
  review: ReviewArtifact | undefined
  currentPhase: CommitteePhase
  completedFiles: string[]
  failedFiles: string[]
  pmMessages: any[]
  coderMessages: any[]
}

export function buildCompactionPrompt(role: "pm" | "coder", input: CompactionInput): string {
  const header =
    role === "pm"
      ? "You are the PM agent. Summarize YOUR perspective (user requirements, design rationale, risks, pending feedback) for context recovery. Use the PM Context section. Read the incoming Shared Consensus and Coder Context — do not duplicate them, but reference them where needed."
      : "You are the Coder agent. Summarize YOUR perspective (files modified, implementation notes, edge cases, technical debt) for context recovery. Use the Coder Context section. Read the incoming Shared Consensus and PM Context — do not duplicate them, but reference them where needed."

  return [
    header,
    "",
    "Current phase: " + input.currentPhase,
    "Completed files: " + (input.completedFiles.length ? input.completedFiles.join(", ") : "(none)"),
    input.plan ? `Plan summary: ${input.plan.summary}` : "",
    "",
    "Full template to produce:",
    COMPACTION_TEMPLATE,
  ]
    .filter(Boolean)
    .join("\n")
}

// ─── Merge — combines PM and Coder compactions into one artifact ───

export function mergeCompactions(
  pmOutput: string,
  coderOutput: string,
  sessionID: string,
): CommitteeCompaction {
  const sharedConsensus = extractSection(pmOutput, "Shared Consensus") ??
    extractSection(coderOutput, "Shared Consensus") ?? ""

  return {
    id: crypto.randomUUID(),
    sessionID,
    sharedConsensus,
    pmContext: extractSection(pmOutput, "PM Context") ?? pmOutput,
    coderContext: extractSection(coderOutput, "Coder Context") ?? coderOutput,
    tokenCount: estimateTokens(pmOutput) + estimateTokens(coderOutput),
    createdAt: Date.now(),
  }
}

function extractSection(text: string, sectionName: string): string | undefined {
  const regex = new RegExp(`## ${sectionName}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`, "i")
  return text.match(regex)?.[1]?.trim()
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5)
}

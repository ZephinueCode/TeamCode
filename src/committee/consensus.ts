import type { ReviewArtifact } from "./protocol"

export type ConsensusResult = "consensus" | "minor_diff" | "stalemate"

/**
 * Rule-based fast path: check if the review indicates consensus without needing
 * an extra LLM call. Only escalate to LLM-based consensus when Coder disagrees
 * but has no blockers.
 */
export function detectConsensus(review: ReviewArtifact): ConsensusResult {
  if (review.overall === "agree") return "consensus"
  if (review.overall === "agree_with_changes" && !review.comments.some((c) => c.severity === "blocker")) {
    return "minor_diff"
  }
  if (review.comments.some((c) => c.severity === "blocker")) return "stalemate"
  return "stalemate"
}

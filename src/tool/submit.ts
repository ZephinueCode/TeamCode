import { Effect } from "effect"
import { define, type ExecuteResult, type ToolContext } from "./tool"

export const SubmitTool = define("submit_to_coder", {
  description: "Submit your plan to the Coder for review. Use this when you have finished analyzing the codebase and produced a complete plan.",
  parameters: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "One-line summary of the task (e.g. 'Add dark mode toggle to settings')",
      },
      approach: {
        type: "string",
        description: "Brief explanation of the implementation approach (what files will change, key decisions, architecture notes). Keep under 200 words.",
      },
    },
    required: ["summary", "approach"],
  },
  execute(args: unknown, _ctx: ToolContext): Effect.Effect<ExecuteResult> {
    const a = args as { summary?: unknown; approach?: unknown }
    const summary = typeof a.summary === "string" ? a.summary.trim() : ""
    const approach = typeof a.approach === "string" ? a.approach.trim() : ""

    if (!summary || !approach) {
      return Effect.succeed({
        title: "Submit to Coder failed",
        output: [
          "Plan was not submitted to Coder.",
          "submit_to_coder requires non-empty summary and approach strings.",
        ].join("\n"),
        metadata: {
          submitted: false,
          error: "missing_required_fields",
          missing: [
            summary ? "" : "summary",
            approach ? "" : "approach",
          ].filter(Boolean),
        },
      })
    }

    return Effect.succeed({
      title: `Submit to Coder: ${summary.slice(0, 80)}`,
      output: [
        `Plan submitted to Coder for review.`,
        ``,
        `Summary: ${summary}`,
        `Approach: ${approach}`,
      ].join("\n"),
      metadata: {
        summary,
        approach,
        submitted: true,
      },
    })
  },
})

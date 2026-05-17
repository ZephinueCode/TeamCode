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
    const a = args as { summary: string; approach: string }
    return Effect.succeed({
      title: `Submit to Coder: ${a.summary.slice(0, 80)}`,
      output: [
        `Plan submitted to Coder for review.`,
        ``,
        `Summary: ${a.summary}`,
        `Approach: ${a.approach}`,
      ].join("\n"),
      metadata: {
        summary: a.summary,
        approach: a.approach,
        submitted: true,
      },
    })
  },
})

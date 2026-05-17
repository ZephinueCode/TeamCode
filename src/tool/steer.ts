import { Effect } from "effect"
import { define, type ExecuteResult, type ToolContext } from "./tool"

export const SteerTool = define("steer", {
  description: [
    "Send correction feedback to the Coder about a file they just wrote.",
    "Use this when the Coder's implementation deviates from the plan.",
    "The Coder will receive this feedback before writing the next file and adjust accordingly.",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      file: {
        type: "string",
        description: "Path to the file that needs correction",
      },
      feedback: {
        type: "string",
        description: "Clear, specific instructions for what the Coder should change. Be precise about what's wrong and how to fix it.",
      },
      severity: {
        type: "string",
        enum: ["must_fix", "suggestion"],
        description: "must_fix = blocking issue that must be resolved before continuing. suggestion = nice-to-have improvement.",
      },
    },
    required: ["file", "feedback"],
  },
  execute(args: unknown, _ctx: ToolContext): Effect.Effect<ExecuteResult> {
    const a = args as { file: string; feedback: string; severity?: string }
    return Effect.succeed({
      title: `Steer: ${a.file.slice(-40)}`,
      output: [
        `Steer feedback sent to Coder for ${a.file}:`,
        `"${a.feedback}"`,
        `Severity: ${a.severity ?? "suggestion"}`,
      ].join("\n"),
      metadata: {
        file: a.file,
        feedback: a.feedback,
        severity: a.severity ?? "suggestion",
        steered: true,
      },
    })
  },
})

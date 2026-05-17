import { Effect } from "effect"
import { define, type ExecuteResult, type ToolContext } from "./tool"

export const TaskTool = define("task", {
  description: [
    "Dispatch the Intern subagent for fast, read-only codebase research.",
    "Use this to explore multiple files, find patterns, or understand code structure in parallel with your own thinking.",
    "The Intern has access to read, glob, and grep only. It returns facts, not recommendations.",
  ].join(" "),
  parameters: {
    type: "object",
    properties: {
      subagent_type: {
        type: "string",
        description: "Must be 'intern' — the only subagent type available for research tasks.",
        enum: ["intern"],
      },
      description: {
        type: "string",
        description: "Short label for what this task does (e.g. 'Find auth middleware', 'Explore database schema')",
      },
      prompt: {
        type: "string",
        description: "Detailed instructions for the Intern. Be specific about what to look for and which files/directories to explore.",
      },
    },
    required: ["subagent_type", "description", "prompt"],
  },
  execute(args: unknown, _ctx: ToolContext): Effect.Effect<ExecuteResult> {
    const a = (args ?? {}) as { subagent_type?: string; description?: string; prompt?: string }
    const desc = a.description ?? "research task"
    const subagent = a.subagent_type ?? "intern"
    const taskPrompt = a.prompt ?? ""
    return Effect.succeed({
      title: `Intern: ${desc.slice(0, 80)}`,
      output: `Intern dispatched: ${desc}`,
      metadata: {
        subagent_type: subagent,
        description: desc,
        prompt: taskPrompt,
        dispatched: true,
      },
    })
  },
})

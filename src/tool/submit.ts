import { Effect } from "effect"
import { define, type ExecuteResult, type ToolContext } from "./tool"

type PlanFile = { path: string; action: "create" | "modify" | "delete"; description: string }

export const SubmitTool = define("submit_to_coder", {
  description: "Submit your plan to the Coder for review. Use this when you have finished analyzing the codebase and produced a complete plan.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: {
        type: "string",
        description: "One-line summary of the task (e.g. 'Add dark mode toggle to settings')",
      },
      approach: {
        type: "string",
        description: "Brief implementation approach: architecture, sequencing, key decisions. Keep under 250 words.",
      },
      files: {
        type: "array",
        description: "Exact files the Coder should create, modify, or delete.",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            path: { type: "string", description: "Workspace-relative file path." },
            action: { type: "string", enum: ["create", "modify", "delete"] },
            description: { type: "string", description: "Concrete change expected in this file." },
          },
          required: ["path", "action", "description"],
        },
      },
      acceptanceCriteria: {
        type: "array",
        description: "User-visible or behavioral conditions that must be true when the work is done.",
        minItems: 1,
        items: { type: "string" },
      },
      verification: {
        type: "array",
        description: "Focused commands or checks the Coder should run, or explain if unable to run.",
        minItems: 1,
        items: { type: "string" },
      },
      risks: {
        type: "array",
        description: "Known risks, edge cases, or assumptions. Use an empty array if none are known.",
        items: { type: "string" },
      },
    },
    required: ["summary", "approach", "files", "acceptanceCriteria", "verification", "risks"],
  },
  execute(args: unknown, _ctx: ToolContext): Effect.Effect<ExecuteResult> {
    const a = args as {
      summary?: unknown
      approach?: unknown
      files?: unknown
      acceptanceCriteria?: unknown
      verification?: unknown
      risks?: unknown
    }
    const summary = typeof a.summary === "string" ? a.summary.trim() : ""
    const approach = typeof a.approach === "string" ? a.approach.trim() : ""
    const files = normalizeFiles(a.files)
    const acceptanceCriteria = normalizeStringArray(a.acceptanceCriteria)
    const verification = normalizeStringArray(a.verification)
    const risks = Array.isArray(a.risks) ? normalizeStringArray(a.risks) : []

    const missing = [
      summary ? "" : "summary",
      approach ? "" : "approach",
      files.length ? "" : "files",
      acceptanceCriteria.length ? "" : "acceptanceCriteria",
      verification.length ? "" : "verification",
      Array.isArray(a.risks) ? "" : "risks",
    ].filter(Boolean)

    if (missing.length) {
      return Effect.succeed({
        title: "Submit to Coder failed",
        output: [
          "Plan was not submitted to Coder.",
          "submit_to_coder requires non-empty summary, approach, files, acceptanceCriteria, verification, and a risks array.",
          `Missing or invalid: ${missing.join(", ")}`,
        ].join("\n"),
        metadata: {
          submitted: false,
          error: "missing_required_fields",
          missing,
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
        `Files:`,
        ...files.map((f) => `- ${f.action} ${f.path}: ${f.description}`),
        `Acceptance Criteria:`,
        ...acceptanceCriteria.map((c) => `- ${c}`),
        `Verification:`,
        ...verification.map((v) => `- ${v}`),
        `Risks:`,
        ...(risks.length ? risks.map((r) => `- ${r}`) : [`- none stated`]),
      ].join("\n"),
      metadata: {
        summary,
        approach,
        files,
        acceptanceCriteria,
        verification,
        risks,
        submitted: true,
      },
    })
  },
})

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
}

function normalizeFiles(value: unknown): PlanFile[] {
  if (!Array.isArray(value)) return []
  const actions = new Set(["create", "modify", "delete"])
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return []
    const raw = item as Record<string, unknown>
    const path = typeof raw.path === "string" ? raw.path.trim() : ""
    const action = typeof raw.action === "string" && actions.has(raw.action) ? raw.action as PlanFile["action"] : undefined
    const description = typeof raw.description === "string" ? raw.description.trim() : ""
    if (!path || !action || !description) return []
    return [{ path, action, description }]
  })
}

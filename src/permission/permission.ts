export type Action = "allow" | "deny" | "ask"

export interface Rule {
  permission: string
  action: Action
  pattern: string
}

export type Ruleset = Rule[]

function wildcardMatch(pattern: string, input: string): boolean {
  const regex = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".")
  return new RegExp(`^${regex}$`).test(input)
}

export function evaluate(tool: string, pattern: string, ruleset: Ruleset): { action: Action } {
  for (let i = ruleset.length - 1; i >= 0; i--) {
    const rule = ruleset[i]!
    if (rule.permission === tool && wildcardMatch(rule.pattern, pattern)) {
      return { action: rule.action }
    }
  }
  return { action: "ask" } // default: ask user
}

export function merge(a: Ruleset, b: Ruleset): Ruleset {
  return [...a, ...b]
}

export function disabled(tools: string[], ruleset: Ruleset): Set<string> {
  const denied = new Set<string>()
  for (const tool of tools) {
    if (evaluate(tool, "*", ruleset).action === "deny") denied.add(tool)
  }
  return denied
}

export function fromConfig(cfg: Record<string, unknown>): Ruleset {
  const rules: Ruleset = []
  for (const [key, value] of Object.entries(cfg)) {
    if (typeof value === "string" && ["allow", "deny", "ask"].includes(value)) {
      rules.push({ permission: key, action: value as Action, pattern: "*" })
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      for (const [pattern, action] of Object.entries(value as Record<string, unknown>)) {
        if (typeof action === "string" && ["allow", "deny", "ask"].includes(action)) {
          rules.push({ permission: key, action: action as Action, pattern })
        }
      }
    }
  }
  return rules
}

/**
 * Derive subagent (Intern) permissions from parent session.
 * Mirrors OpenCode's subagent-permissions.ts logic:
 * 1. Carry forward parent agent's deny rules
 * 2. Carry forward session-level deny rules
 * 3. Default-deny recursive subagent spawning and todowrite
 */
export function deriveSubagentPermission(input: {
  parentPermission: Ruleset
  subagent: { defaultPermission: Record<string, { action: Action; pattern: string }> }
}): Ruleset {
  const subagentRules: Ruleset = Object.entries(input.subagent.defaultPermission).map(
    ([perm, rule]) => ({
      permission: perm,
      action: rule.action,
      pattern: rule.pattern,
    }),
  )

  // Parent deny rules override subagent defaults
  const parentDenies = input.parentPermission.filter((r) => r.action === "deny")

  return merge(subagentRules, parentDenies)
}

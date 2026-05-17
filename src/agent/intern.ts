export const InternAgent = {
  name: "intern" as const,
  description:
    "Intern — fast lightweight subagent (4B-8B) for file summarization, code structure analysis, and basic research. Use for quick read-only tasks to reduce load on PM and Coder.",
  temperature: 0.05,
  mode: "subagent" as const,
  color: "#B0B0B0",

  defaultPermission: {
    read: { action: "allow" as const, pattern: "*" },
    glob: { action: "allow" as const, pattern: "*" },
    grep: { action: "allow" as const, pattern: "*" },
    shell: { action: "deny" as const, pattern: "*" },
    write: { action: "deny" as const, pattern: "*" },
    edit: { action: "deny" as const, pattern: "*" },
    task: { action: "deny" as const, pattern: "*" },
    skill: { action: "deny" as const, pattern: "*" },
  },
}

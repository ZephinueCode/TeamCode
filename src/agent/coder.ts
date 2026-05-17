export const CoderAgent = {
  name: "coder" as const,
  description: "Coder — autonomous code generation agent with plan review and execution authority",
  temperature: 0.1,
  color: "#50C878",

  // Coder has MORE autonomy than a subagent — it can initiate file changes
  // and push back on PM plans. But less than PM — it can't interact with the user.
  defaultPermission: {
    read: { action: "allow" as const, pattern: "*" },
    glob: { action: "allow" as const, pattern: "*" },
    grep: { action: "allow" as const, pattern: "*" },
    shell: { action: "allow" as const, pattern: "*" },
    write: { action: "allow" as const, pattern: "*" },
    edit: { action: "allow" as const, pattern: "*" },
    skill: { action: "allow" as const, pattern: "*" },
    task: { action: "allow" as const, pattern: "*" },
  },
}

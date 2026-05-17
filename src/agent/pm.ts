export const PMAgent = {
  name: "pm" as const,
  description: "Product Manager — user-facing agent for requirements, planning, and review",
  temperature: 0.3,
  color: "#4A90D9",

  defaultPermission: {
    read: { action: "allow" as const, pattern: "*" },
    glob: { action: "allow" as const, pattern: "*" },
    grep: { action: "allow" as const, pattern: "*" },
    skill: { action: "allow" as const, pattern: "*" },
    task: { action: "allow" as const, pattern: "*" },
    shell: { action: "deny" as const, pattern: "*" },
    write: { action: "deny" as const, pattern: "*" },
    edit: { action: "deny" as const, pattern: "*" },
  },
}

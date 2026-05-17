import { Effect, Layer, Context, Schema } from "effect"
import * as fs from "fs/promises"
import path from "path"
import { glob } from "glob"
import type { Ruleset } from "../permission/permission"
import { evaluate } from "../permission/permission"

// ad-hoc markdown frontmatter parser — avoids gray-matter dependency
async function parseFrontmatter(filepath: string): Promise<{ name: string; description?: string; content: string } | undefined> {
  const text = await fs.readFile(filepath, "utf-8")
  const match = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/)
  if (!match) return undefined
  const frontmatter = match[1]!
  const content = match[2]!.trim()
  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m)
  const descMatch = frontmatter.match(/^description:\s*(.+)$/m)
  if (!nameMatch) return undefined
  return {
    name: nameMatch[1]!.trim(),
    description: descMatch?.[1]?.trim(),
    content,
  }
}

export interface SkillInfo {
  name: string
  description?: string
  location: string
  content: string
}

export interface Interface {
  readonly get: (name: string) => Effect.Effect<SkillInfo | undefined>
  readonly all: () => Effect.Effect<SkillInfo[]>
  readonly available: (permission: Ruleset) => Effect.Effect<SkillInfo[]>
  readonly reload: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@teamcode/Skill") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    let skills: Record<string, SkillInfo> = {}

    const scan = Effect.fn("Skill.scan")(function* (dirs: string[]) {
      const found: Record<string, SkillInfo> = {}
      for (const dir of dirs) {
        try {
          const matches = yield* Effect.promise(() =>
            glob("{skill,skills}/**/SKILL.md", { cwd: dir, absolute: true, nodir: true }),
          )
          for (const match of matches) {
            const parsed = yield* Effect.promise(() => parseFrontmatter(match))
            if (parsed) found[parsed.name] = { ...parsed, location: match }
          }
        } catch {}
      }
      return found
    })

    const load = Effect.fn("Skill.load")(function* () {
      const home = process.env.HOME ?? process.env.USERPROFILE ?? "~"
      const dirs = [
        path.join(home, ".teamcode"),
        path.join(process.cwd(), ".teamcode"),
      ]
      skills = yield* scan(dirs)
    })

    yield* load()

    return Service.of({
      get: Effect.fn("Skill.get")(function* (name) {
        return skills[name]
      }),
      all: Effect.fn("Skill.all")(function* () {
        return Object.values(skills).toSorted((a, b) => a.name.localeCompare(b.name))
      }),
      available: Effect.fn("Skill.available")(function* (permission) {
        return Object.values(skills)
          .filter((s) => evaluate("skill", s.name, permission).action !== "deny")
          .toSorted((a, b) => a.name.localeCompare(b.name))
      }),
      reload: load,
    })
  }),
)

export const defaultLayer = layer

export function fmt(list: SkillInfo[], opts: { verbose: boolean }): string {
  const described = list.filter((s) => s.description)
  if (!described.length) return "No skills are currently available."
  if (opts.verbose) {
    return [
      "<available_skills>",
      ...described.map((s) => `  <skill>\n    <name>${s.name}</name>\n    <description>${s.description}</description>\n    <location>${s.location}</location>\n  </skill>`),
      "</available_skills>",
    ].join("\n")
  }
  return ["## Available Skills", ...described.map((s) => `- **${s.name}**: ${s.description}`)].join("\n")
}

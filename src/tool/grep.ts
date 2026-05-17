import { Effect, Schema } from "effect"
import { glob } from "glob"
import * as fs from "fs/promises"
import path from "path"
import { define } from "./tool"

const GrepInput = Schema.Struct({
  pattern: Schema.String,
  path: Schema.optional(Schema.String),
  glob: Schema.optional(Schema.String),
  maxResults: Schema.optional(Schema.Number),
})

export const GrepTool = define("grep", {
  description: "Search for a regex pattern in file contents",
  parameters: GrepInput,
  execute(input) {
    return Effect.gen(function* () {
      const args = input as { pattern: string; path?: string; glob?: string; maxResults?: number }
      const cwd = args.path ? path.resolve(args.path) : process.cwd()
      const filePattern = args.glob ?? "**/*.{ts,tsx,js,jsx,json,md,txt}"
      const maxResults = args.maxResults ?? 250

      const files = yield* Effect.promise(() =>
        glob(filePattern, {
          cwd,
          nodir: true,
          dot: true,
          ignore: ["node_modules/**", ".git/**", "dist/**", "*.lock"],
        }),
      )

      const regex = new RegExp(args.pattern, "gi")
      const results: string[] = []

      for (const file of files) {
        if (results.length >= maxResults) break
        try {
          const content = yield* Effect.promise(() => fs.readFile(path.join(cwd, file), "utf-8"))
          const lines = content.split("\n")
          for (let i = 0; i < lines.length && results.length < maxResults; i++) {
            if (regex.test(lines[i]!)) {
              results.push(`${file}:${i + 1}: ${lines[i]!.trim()}`)
              regex.lastIndex = 0
            }
          }
        } catch {}
      }

      const output = results.length
        ? results.join("\n")
        : `No matches for "${args.pattern}"`

      return {
        title: `Grep: ${args.pattern}`,
        output,
        metadata: { pattern: args.pattern, count: results.length },
      }
    })
  },
})

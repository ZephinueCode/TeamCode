import { Effect, Schema } from "effect"
import { glob } from "glob"
import path from "path"
import { define } from "./tool"

const GlobInput = Schema.Struct({
  pattern: Schema.String,
  path: Schema.optional(Schema.String),
})

export const GlobTool = define("glob", {
  description: "Find files matching a glob pattern",
  parameters: GlobInput,
  execute(input) {
    return Effect.gen(function* () {
      const args = input as { pattern: string; path?: string }
      const cwd = args.path ? path.resolve(args.path) : process.cwd()
      const files = yield* Effect.promise(() =>
        glob(args.pattern, {
          cwd,
          nodir: true,
          dot: true,
          ignore: ["node_modules/**", ".git/**"],
        }),
      )

      const sorted = files.sort()
      const output = sorted.length
        ? sorted.join("\n")
        : `No files matching "${args.pattern}" found`

      return {
        title: `Glob: ${args.pattern}`,
        output,
        metadata: { pattern: args.pattern, count: sorted.length, files: sorted },
      }
    })
  },
})

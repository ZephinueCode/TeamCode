import { Effect, Schema } from "effect"
import * as fs from "fs/promises"
import path from "path"
import { define } from "./tool"

const LsInput = Schema.Struct({
  path: Schema.optional(Schema.String),
})

export const LsTool = define("ls", {
  description: "List files and directories in a given path. Defaults to current working directory.",
  parameters: LsInput,
  execute(input) {
    return Effect.gen(function* () {
      const args = input as { path?: string }
      const dir = args.path ? path.resolve(args.path) : process.cwd()
      const entries = yield* Effect.promise(() => fs.readdir(dir, { withFileTypes: true }))
      const lines = entries
        .sort((a, b) => {
          if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
          return a.name.localeCompare(b.name)
        })
        .map((e) => `${e.isDirectory() ? "📁" : "📄"} ${e.name}${e.isDirectory() ? "/" : ""}`)
      return {
        title: `ls ${dir}`,
        output: lines.length ? lines.join("\n") : "(empty directory)",
        metadata: { path: dir, count: entries.length },
      }
    })
  },
})

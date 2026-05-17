import { Effect, Schema } from "effect"
import * as fs from "fs/promises"
import { define } from "./tool"

const ReadInput = Schema.Struct({
  filePath: Schema.String,
  offset: Schema.optional(Schema.Number),
  limit: Schema.optional(Schema.Number),
})

export const ReadTool = define("read", {
  description: "Read the contents of a file with optional offset and limit",
  parameters: ReadInput,
  execute(input) {
    return Effect.gen(function* () {
      const args = input as { filePath: string; offset?: number; limit?: number }
      const content = yield* Effect.promise(() => fs.readFile(args.filePath, "utf-8"))
      const lines = content.split("\n")
      const start = Math.max(0, (args.offset ?? 1) - 1)
      const end = args.limit ? start + args.limit : lines.length
      const sliced = lines.slice(start, end)
      const output = sliced
        .map((line, i) => `${String(start + i + 1).padStart(4)} │ ${line}`)
        .join("\n")
      return {
        title: `Read ${args.filePath}${args.offset ? ` (from line ${args.offset})` : ""}`,
        output: output || "(empty file)",
        metadata: { path: args.filePath, totalLines: lines.length },
      }
    })
  },
})

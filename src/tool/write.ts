import { Effect, Schema } from "effect"
import * as fs from "fs/promises"
import path from "path"
import { define } from "./tool"

const WriteInput = Schema.Struct({
  filePath: Schema.String,
  content: Schema.String,
})

export const WriteTool = define("write", {
  description: "Write content to a file, creating it if it doesn't exist",
  parameters: WriteInput,
  execute(input) {
    return Effect.gen(function* () {
      const args = input as { filePath: string; content: string }
      yield* Effect.promise(() => fs.mkdir(path.dirname(args.filePath), { recursive: true }))
      yield* Effect.promise(() => fs.writeFile(args.filePath, args.content, "utf-8"))
      const lines = args.content.split("\n")
      return {
        title: `Wrote ${args.filePath}`,
        output: `Created/overwrote ${args.filePath} (${lines.length} lines)`,
        metadata: { path: args.filePath, lines: lines.length },
      }
    })
  },
})

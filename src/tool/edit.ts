import { Effect, Schema } from "effect"
import * as fs from "fs/promises"
import { define } from "./tool"

const EditInput = Schema.Struct({
  filePath: Schema.String,
  oldString: Schema.String,
  newString: Schema.String,
  replaceAll: Schema.optional(Schema.Boolean),
})

export const EditTool = define("edit", {
  description: "Replace a string in a file. oldString must match exactly once (or set replaceAll for all occurrences)",
  parameters: EditInput,
  execute(input) {
    return Effect.gen(function* () {
      const args = input as { filePath: string; oldString: string; newString: string; replaceAll?: boolean }
      const content = yield* Effect.promise(() => fs.readFile(args.filePath, "utf-8"))

      const occurrences = content.split(args.oldString).length - 1
      if (occurrences === 0) {
        return {
          title: `Edit failed: ${args.filePath}`,
          output: `String not found in ${args.filePath}`,
          metadata: { path: args.filePath, error: "not_found" },
        }
      }

      if (!args.replaceAll && occurrences > 1) {
        return {
          title: `Edit failed: ${args.filePath}`,
          output: `Found ${occurrences} occurrences of the string in ${args.filePath}. Use replaceAll: true to replace all, or make oldString more specific.`,
          metadata: { path: args.filePath, error: "multiple_matches", count: occurrences },
        }
      }

      const updated = args.replaceAll ? content.replaceAll(args.oldString, args.newString) : content.replace(args.oldString, args.newString)
      yield* Effect.promise(() => fs.writeFile(args.filePath, updated, "utf-8"))

      return {
        title: `Edited ${args.filePath}`,
        output: `Replaced ${args.replaceAll ? occurrences : 1} occurrence(s) in ${args.filePath}`,
        metadata: { path: args.filePath, occurrences: args.replaceAll ? occurrences : 1 },
      }
    })
  },
})

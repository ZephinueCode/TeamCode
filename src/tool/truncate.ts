import { Effect, Layer, Context } from "effect"
import * as fs from "fs/promises"
import path from "path"
import os from "os"

const TRUNCATION_DIR = path.join(os.tmpdir(), "teamcode-truncations")
const DEFAULT_MAX_LINES = 2000
const DEFAULT_MAX_BYTES = 51200

export interface Interface {
  readonly output: (content: string, opts?: { maxLines?: number; maxBytes?: number }) => Effect.Effect<{
    content: string
    truncated: boolean
    outputPath?: string
  }>
  readonly cleanup: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@teamcode/Truncate") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    return Service.of({
      output: Effect.fn("Truncate.output")(function* (content, opts) {
        const maxLines = opts?.maxLines ?? DEFAULT_MAX_LINES
        const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES
        const lines = content.split("\n")
        const bytes = Buffer.byteLength(content, "utf-8")

        if (lines.length <= maxLines && bytes <= maxBytes) {
          return { content, truncated: false }
        }

        yield* Effect.promise(() => fs.mkdir(TRUNCATION_DIR, { recursive: true }))
        const file = path.join(TRUNCATION_DIR, `${Date.now()}-${Math.random().toString(36).slice(2)}.txt`)
        yield* Effect.promise(() => fs.writeFile(file, content, "utf-8"))

        const preview = lines.slice(0, maxLines).join("\n")
        const truncated = preview.length < content.length ? preview + "\n... [truncated]" : preview

        return {
          content: truncated,
          truncated: true,
          outputPath: file,
        }
      }),
      cleanup: Effect.fn("Truncate.cleanup")(function* () {
        yield* Effect.tryPromise(() => fs.readdir(TRUNCATION_DIR)).pipe(
          Effect.flatMap((files) =>
            Effect.forEach(files, (file) =>
              Effect.tryPromise(async () => {
                const filepath = path.join(TRUNCATION_DIR, file)
                const stat = await fs.stat(filepath)
                if (Date.now() - stat.mtimeMs > 3600000) await fs.unlink(filepath)
              }),
            ),
          ),
          Effect.ignore,
        )
      }),
    })
  }),
)

export const defaultLayer = layer

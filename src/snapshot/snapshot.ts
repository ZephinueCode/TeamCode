import { Effect, Layer, Context } from "effect"
import * as fs from "fs/promises"
import path from "path"
import { spawn } from "cross-spawn"

export interface Patch {
  hash: string
  files: string[]
}

export interface Interface {
  readonly init: () => Effect.Effect<void>
  readonly track: () => Effect.Effect<string | undefined>
  readonly patch: (hash: string) => Effect.Effect<Patch>
}

export class Service extends Context.Service<Service, Interface>()("@teamcode/Snapshot") {}

function runGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd })
    let stdout = ""
    let stderr = ""
    child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()))
    child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()))
    child.on("close", (code) => resolve({ stdout, stderr, code }))
    child.on("error", (err) => resolve({ stdout, stderr: String(err), code: null }))
  })
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const cwd = process.cwd()

    return Service.of({
      init: Effect.fn("Snapshot.init")(function* () {
        const snapDir = path.join(cwd, ".teamcode", "snapshots")
        yield* Effect.promise(() => fs.mkdir(snapDir, { recursive: true }))
      }),

      track: Effect.fn("Snapshot.track")(function* () {
        yield* Effect.promise(() => runGit(["add", "-A", "--", "."], cwd))
        const result = yield* Effect.promise(() => runGit(["write-tree"], cwd))
        return result.stdout?.trim() || undefined
      }),

      patch: Effect.fn("Snapshot.patch")(function* (hash) {
        if (!hash) return { hash: "", files: [] }
        const result = yield* Effect.promise(() =>
          runGit(["diff-tree", "--name-only", "-r", hash, "HEAD"], cwd),
        )
        const files = result.stdout.trim().split("\n").filter(Boolean)
        return { hash, files }
      }),
    })
  }),
)

export const defaultLayer = layer

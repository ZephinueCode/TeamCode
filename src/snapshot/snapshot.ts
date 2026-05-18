import { Effect, Layer, Context } from "effect"
import * as fs from "fs/promises"
import path from "path"
import { spawn } from "cross-spawn"
import { randomUUID } from "crypto"

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
        const snapDir = path.join(cwd, ".teamcode", "snapshots")
        yield* Effect.promise(() => fs.mkdir(snapDir, { recursive: true }))

        const id = randomUUID()
        const diff = yield* Effect.promise(() => runGit(["diff", "--binary", "HEAD", "--", "."], cwd))
        const changed = yield* Effect.promise(() => runGit(["diff", "--name-only", "HEAD", "--", "."], cwd))
        const untracked = yield* Effect.promise(() => runGit(["ls-files", "--others", "--exclude-standard"], cwd))
        const files = Array.from(new Set([
          ...changed.stdout.trim().split("\n").filter(Boolean),
          ...untracked.stdout.trim().split("\n").filter(Boolean),
        ])).sort()

        yield* Effect.promise(() => fs.writeFile(
          path.join(snapDir, `${id}.json`),
          JSON.stringify({ id, files, diff: diff.stdout, time: Date.now() }, null, 2),
          "utf-8",
        ))
        return id
      }),

      patch: Effect.fn("Snapshot.patch")(function* (hash) {
        if (!hash) return { hash: "", files: [] }
        try {
          const text = yield* Effect.promise(() => fs.readFile(path.join(cwd, ".teamcode", "snapshots", `${hash}.json`), "utf-8"))
          const parsed = JSON.parse(text) as { files?: string[] }
          return { hash, files: parsed.files ?? [] }
        } catch {
          return { hash, files: [] }
        }
      }),
    })
  }),
)

export const defaultLayer = layer

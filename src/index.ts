#!/usr/bin/env bun
/**
 * TeamCode — Committee Coding AI Agent
 */
import yargs from "yargs"
import { hideBin } from "yargs/helpers"
import { Effect, Exit, Layer } from "effect"
import { layer as providerLayer } from "./provider/provider"
import { layer as llmLayer } from "./llm/llm"
import { layer as toolRegistryLayer } from "./tool/registry"
import { layer as sessionLayer } from "./session/session"
import { layer as configLayer } from "./config/config"
import { layer as snapshotLayer } from "./snapshot/snapshot"
import { layer as skillLayer } from "./skill/skill"
import { runCommittee } from "./committee/controller"
import * as Tui from "./ui/tui"

// Graceful exit on Ctrl+C
process.on("SIGINT", () => { Tui.cleanup(); process.exit(0) })

const args = hideBin(process.argv)

// Exit directly on Ctrl+C, no "Terminate batch job?" prompt (Windows)
process.on("SIGINT", () => { process.stdout.write("\x1b[r\n"); process.exit(0) })
process.on("SIGTERM", () => process.exit(0))
// Windows cmd.exe sends Ctrl+C as stdin data when a child process is running;
// intercept it via the readline/keypress handler. For Bun on Windows, we also
// need to disable the default Ctrl+C handling by cmd.exe.
if (process.platform === "win32") {
  // On Windows, set console mode to handle Ctrl+C ourselves
  try {
    const kernel32 = require("node:ffi") ?? null // skip if not available
  } catch {}
}

yargs(args)
  .scriptName("teamcode")
  .wrap(100)
  .help()
  .alias("help", "h")
  .command(
    "$0",
    "Start TeamCode committee mode",
    (y) =>
      y
        .option("config", { alias: "c", type: "string", description: "Path to teamcode.jsonc" })
        .option("session", { alias: "s", type: "string", description: "Resume a session by ID" }),
    async (argv: any) => {
      if (argv.config) process.env.TEAMCODE_CONFIG = argv.config

      await Tui.init()

      const program = Effect.gen(function* () {
        yield* runCommittee({ sessionID: argv.session })
      })

      const layered = program.pipe(
        Effect.provide(providerLayer),
        Effect.provide(llmLayer),
        Effect.provide(toolRegistryLayer),
        Effect.provide(sessionLayer),
        Effect.provide(skillLayer),
        Effect.provide(snapshotLayer),
        Effect.provide(configLayer),
      )

      const exit = await Effect.runPromiseExit(layered as any)

      Tui.cleanup()

      if (Exit.isFailure(exit)) {
        console.error("TeamCode error:", Exit.isFailure(exit) ? String(exit.cause) : String(exit))
        process.exit(1)
      }
    },
  )
  .parse()

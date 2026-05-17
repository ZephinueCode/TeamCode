import { Effect, Layer, Context } from "effect"
import { ShellTool } from "./shell"
import { ReadTool } from "./read"
import { WriteTool } from "./write"
import { EditTool } from "./edit"
import { GlobTool } from "./glob"
import { GrepTool } from "./grep"
import { LsTool } from "./ls"
import { SubmitTool } from "./submit"
import { TaskTool } from "./task"
import { SteerTool } from "./steer"
import * as Tool from "./tool"

export interface Interface {
  readonly all: () => Effect.Effect<Tool.Def[], never, never>
}

export class Service extends Context.Service<Service, Interface>()("@teamcode/ToolRegistry") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const shell = yield* Tool.init(yield* ShellTool)
    const read = yield* Tool.init(yield* ReadTool)
    const write = yield* Tool.init(yield* WriteTool)
    const edit = yield* Tool.init(yield* EditTool)
    const glob = yield* Tool.init(yield* GlobTool)
    const grep = yield* Tool.init(yield* GrepTool)
    const ls = yield* Tool.init(yield* LsTool)
    const submit = yield* Tool.init(yield* SubmitTool)
    const task = yield* Tool.init(yield* TaskTool)
    const steer = yield* Tool.init(yield* SteerTool)

    const builtins = [shell, read, write, edit, glob, grep, ls, submit, task, steer]

    return Service.of({
      all: () => Effect.succeed(builtins),
    })
  }),
)

export const defaultLayer = layer

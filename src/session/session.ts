import { Effect, Layer, Context } from "effect"
import { randomUUID } from "crypto"
import type { WithParts } from "./message"

export interface SessionInfo {
  id: string
  parentID?: string
  title: string
  agent?: string
  modelProvider?: string
  modelID?: string
  directory: string
  cost: number
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } }
  time: { created: number; updated: number }
}

export interface Interface {
  readonly create: (input: { parentID?: string; title: string; agent: string; directory: string; modelProvider: string; modelID: string }) => Effect.Effect<SessionInfo>
  readonly get: (id: string) => Effect.Effect<SessionInfo | undefined>
  readonly list: (directory?: string) => Effect.Effect<SessionInfo[]>
  readonly messages: (sessionID: string) => Effect.Effect<WithParts[]>
  readonly appendMessage: (msg: WithParts) => Effect.Effect<void>
  readonly updateMessage: (msg: WithParts) => Effect.Effect<void>
  readonly touch: (id: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@teamcode/Session") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const sessions = new Map<string, SessionInfo>()
    const messages = new Map<string, WithParts[]>()

    return Service.of({
      create: Effect.fn("Session.create")(function* (input) {
        const id = randomUUID()
        const now = Date.now()
        const info: SessionInfo = {
          id, parentID: input.parentID, title: input.title,
          agent: input.agent, modelProvider: input.modelProvider, modelID: input.modelID,
          directory: input.directory, cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: now, updated: now },
        }
        sessions.set(id, info)
        messages.set(id, [])
        return info
      }),

      get: Effect.fn("Session.get")(function* (id) {
        return sessions.get(id)
      }),

      list: Effect.fn("Session.list")(function* (_directory) {
        return Array.from(sessions.values())
      }),

      messages: Effect.fn("Session.messages")(function* (sessionID) {
        return messages.get(sessionID) ?? []
      }),

      appendMessage: Effect.fn("Session.append")(function* (msg) {
        const msgs = messages.get(msg.sessionID) ?? []
        msgs.push(msg)
        messages.set(msg.sessionID, msgs)
      }),

      updateMessage: Effect.fn("Session.update")(function* (msg) {
        const msgs = messages.get(msg.sessionID) ?? []
        const idx = msgs.findIndex((m) => m.id === msg.id)
        if (idx >= 0) msgs[idx] = msg
        else msgs.push(msg)
        messages.set(msg.sessionID, msgs)
      }),

      touch: Effect.fn("Session.touch")(function* (id) {
        const s = sessions.get(id)
        if (s) s.time.updated = Date.now()
      }),
    })
  }),
)

export const defaultLayer = layer

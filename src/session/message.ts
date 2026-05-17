export interface TextPart {
  type: "text"
  id: string
  sessionID: string
  messageID: string
  text: string
  synthetic?: boolean
}

export interface ReasoningPart {
  type: "reasoning"
  id: string
  sessionID: string
  messageID: string
  text: string
}

export interface ToolPart {
  type: "tool"
  id: string
  sessionID: string
  messageID: string
  callID: string
  tool: string
  state:
    | { status: "pending"; input: unknown }
    | { status: "running"; input: unknown; time: { start: number } }
    | { status: "completed"; input: unknown; output: string; title: string; metadata: Record<string, unknown>; time: { start: number; end: number } }
    | { status: "error"; input: unknown; error: string; time: { start: number; end: number } }
}

export interface StepStartPart { type: "step-start"; id: string; sessionID: string; messageID: string; snapshot?: string }
export interface StepFinishPart { type: "step-finish"; id: string; sessionID: string; messageID: string; reason: string; cost: number; tokens: Tokens; snapshot?: string }
export interface PatchPart { type: "patch"; id: string; sessionID: string; messageID: string; hash: string; files: string[] }
export interface CompactionPart { type: "compaction"; id: string; sessionID: string; messageID: string; tail_start_id?: string }

export type Part = TextPart | ReasoningPart | ToolPart | StepStartPart | StepFinishPart | PatchPart | CompactionPart

export interface Tokens {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

export interface Message {
  id: string
  role: "user" | "assistant"
  sessionID: string
  agent: string
  model: { providerID: string; modelID: string }
  parentID?: string
  cost: number
  tokens: Tokens
  time: { created: number; completed?: number }
  finish?: string
  error?: unknown
  summary?: boolean
}

export type WithParts = Message & { parts: Part[] }

export function empty(overrides: Partial<Message> = {}): WithParts {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    sessionID: "",
    agent: "",
    model: { providerID: "", modelID: "" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: Date.now() },
    parts: [],
    ...overrides,
  } as WithParts
}

export function latest(msgs: WithParts[]): { user?: WithParts; assistant?: WithParts } {
  const user = msgs.findLast((m) => m.role === "user")
  const assistant = msgs.findLast((m) => m.role === "assistant" && m.finish)
  return { user, assistant }
}

/**
 * TUI Input system — line editing with history, autocomplete, and keybindings.
 *
 * Inspired by OpenCode's prompt component (prompt/index.tsx + history.tsx).
 * Uses Node's readline for raw-mode input handling.
 */
import * as fs from "fs/promises"
import * as path from "path"
import os from "os"

const HISTORY_FILE = path.join(os.homedir(), ".teamcode", "prompt-history.jsonl")
const MAX_HISTORY = 500

export interface PromptEntry {
  text: string
  agent?: string
  timestamp: number
}

export interface AutocompleteMatch {
  text: string
  description: string
  replacement: string
}

export interface InputState {
  value: string
  cursor: number
  history: PromptEntry[]
  historyIndex: number
  autocomplete: AutocompleteMatch[]
  autocompleteIndex: number
  autocompleteVisible: boolean
  prefix: string // the '/' or '@' prefix that triggered autocomplete
}

// ── History persistence (replicates OpenCode's prompt/history.tsx JSONL pattern) ──

async function loadHistory(): Promise<PromptEntry[]> {
  try {
    const text = await fs.readFile(HISTORY_FILE, "utf-8")
    return text
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as PromptEntry)
      .slice(-MAX_HISTORY)
  } catch {
    return []
  }
}

async function saveHistory(entries: PromptEntry[]): Promise<void> {
  try {
    await fs.mkdir(path.dirname(HISTORY_FILE), { recursive: true })
    await fs.writeFile(HISTORY_FILE, entries.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf-8")
  } catch {}
}

// ── State management ──

export function createInputState(): InputState {
  return {
    value: "",
    cursor: 0,
    history: [],
    historyIndex: -1,
    autocomplete: [],
    autocompleteIndex: 0,
    autocompleteVisible: false,
    prefix: "",
  }
}

export async function initHistory(): Promise<void> {
  const entries = await loadHistory()
  // loaded on first access via the module
}

// ── Key handling ──

export interface KeyResult {
  consumed: boolean
  value?: string // committed text, if submit
  redraw: boolean
}

export function handleInputKey(state: InputState, key: string, autocompleteSource?: (prefix: string, text: string) => AutocompleteMatch[]): KeyResult {
  // Special keys
  if (key === "\r" || key === "\n") {
    return handleSubmit(state)
  }
  if (key === "\x7f" || key === "\b") {
    return handleBackspace(state)
  }
  if (key === "\t") {
    return handleTab(state, autocompleteSource)
  }
  if (key === "\x1b[A") {
    // Up arrow — history
    return handleHistoryUp(state)
  }
  if (key === "\x1b[B") {
    // Down arrow — history
    return handleHistoryDown(state)
  }
  if (key === "\x1b") {
    // Escape — close autocomplete
    if (state.autocompleteVisible) {
      state.autocompleteVisible = false
      state.autocomplete = []
      return { consumed: true, redraw: true }
    }
    return { consumed: false, redraw: false }
  }
  if (key === "\x1b[C") {
    // Right arrow
    if (state.cursor < state.value.length) state.cursor++
    return { consumed: true, redraw: false }
  }
  if (key === "\x1b[D") {
    // Left arrow
    if (state.cursor > 0) state.cursor--
    return { consumed: true, redraw: false }
  }
  if (key === "\x01") {
    // Ctrl+A — home
    state.cursor = 0
    return { consumed: true, redraw: false }
  }
  if (key === "\x05") {
    // Ctrl+E — end
    state.cursor = state.value.length
    return { consumed: true, redraw: false }
  }
  if (key === "\x0b") {
    // Ctrl+K — kill to end
    state.value = state.value.slice(0, state.cursor)
    return { consumed: true, redraw: true }
  }
  if (key === "\x17") {
    // Ctrl+W — kill word
    const before = state.value.slice(0, state.cursor)
    const after = state.value.slice(state.cursor)
    const words = before.split(/\b/)
    words.pop()
    state.value = words.join("") + after
    state.cursor = words.join("").length
    return { consumed: true, redraw: true }
  }

  // Printable characters
  if (key.length === 1 && key.charCodeAt(0) >= 32) {
    state.value = state.value.slice(0, state.cursor) + key + state.value.slice(state.cursor)
    state.cursor++

    // Trigger autocomplete on '/' or '@'
    if (key === "/" || key === "@") {
      state.autocompleteVisible = true
      state.prefix = key
      state.autocompleteIndex = 0
      if (autocompleteSource) {
        state.autocomplete = autocompleteSource(key, state.value)
      }
    } else if (state.autocompleteVisible && autocompleteSource) {
      state.autocomplete = autocompleteSource(state.prefix, state.value)
      if (state.autocomplete.length === 0) state.autocompleteVisible = false
    }

    return { consumed: true, redraw: true }
  }

  return { consumed: false, redraw: false }
}

function handleSubmit(state: InputState): KeyResult {
  if (state.autocompleteVisible && state.autocomplete.length > 0) {
    // Select current autocomplete item
    const item = state.autocomplete[state.autocompleteIndex]
    if (item) {
      state.value = item.replacement
      state.cursor = state.value.length
      state.autocompleteVisible = false
      state.autocomplete = []
      return { consumed: true, redraw: true }
    }
  }
  const text = state.value.trim()
  if (text) {
    state.history.push({ text, timestamp: Date.now() })
    if (state.history.length > MAX_HISTORY) state.history.shift()
    saveHistory(state.history).catch(() => {})
  }
  state.historyIndex = -1
  const committed = state.value
  state.value = ""
  state.cursor = 0
  state.autocompleteVisible = false
  state.autocomplete = []
  return { consumed: true, value: committed, redraw: true }
}

function handleBackspace(state: InputState): KeyResult {
  if (state.cursor > 0) {
    state.value = state.value.slice(0, state.cursor - 1) + state.value.slice(state.cursor)
    state.cursor--
  }
  if (state.value === "" || !state.value.startsWith(state.prefix)) {
    state.autocompleteVisible = false
    state.autocomplete = []
  }
  return { consumed: true, redraw: true }
}

function handleTab(state: InputState, source?: (prefix: string, text: string) => AutocompleteMatch[]): KeyResult {
  if (state.autocompleteVisible) {
    // Cycle through autocomplete
    state.autocompleteIndex = (state.autocompleteIndex + 1) % state.autocomplete.length
    return { consumed: true, redraw: true }
  }
  // Trigger autocomplete
  if (state.value.startsWith("/") || state.value.startsWith("@")) {
    state.autocompleteVisible = true
    state.prefix = state.value.startsWith("/") ? "/" : "@"
    state.autocompleteIndex = 0
    if (source) state.autocomplete = source(state.prefix, state.value)
    return { consumed: true, redraw: true }
  }
  return { consumed: false, redraw: false }
}

function handleHistoryUp(state: InputState): KeyResult {
  if (state.history.length === 0) return { consumed: false, redraw: false }
  if (state.historyIndex === -1) state.historyIndex = state.history.length - 1
  else if (state.historyIndex > 0) state.historyIndex--
  const entry = state.history[state.historyIndex]
  if (entry) {
    state.value = entry.text
    state.cursor = state.value.length
  }
  return { consumed: true, redraw: true }
}

function handleHistoryDown(state: InputState): KeyResult {
  if (state.historyIndex === -1) return { consumed: false, redraw: false }
  state.historyIndex++
  if (state.historyIndex >= state.history.length) {
    state.historyIndex = -1
    state.value = ""
    state.cursor = 0
  } else {
    const entry = state.history[state.historyIndex]
    if (entry) {
      state.value = entry.text
      state.cursor = state.value.length
    }
  }
  return { consumed: true, redraw: true }
}

// ── Autocomplete rendering ──

export function renderAutocomplete(matches: AutocompleteMatch[], selectedIndex: number, maxHeight: number = 10): string[] {
  const visible = matches.slice(0, maxHeight)
  return visible.map((m, i) => {
    const prefix = i === selectedIndex ? "▶" : " "
    const desc = m.description ? `  \x1b[2m${m.description}\x1b[0m` : ""
    return `${prefix} ${m.text}${desc}`
  })
}

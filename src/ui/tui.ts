/**
 * TeamCode TUI — OpenTUI-based terminal UI.
 *
 * Layout (OpenCode-style):
 *   Root (Box, flexDirection: column)
 *   ├── Content Box (paddingLeft: 1, flexGrow: 1)
 *   │   └── ScrollBox (message area)
 *   └── Footer (Box, flexShrink: 0, paddingLeft: 1)
 *       ├── Status row
 *       └── Input
 *
 * All messages rendered via OpenTUI props (fg, attributes, wrapMode) — never inline ANSI.
 */
import {
  createCliRenderer, BoxRenderable, TextRenderable, ScrollBoxRenderable,
  TextareaRenderable, MarkdownRenderable, SyntaxStyle, TextAttributes, RGBA,
} from "@opentui/core"
import { copy as copyToClipboard } from "../util/clipboard"
import { selectPrompt, type SelectOption, type SelectPromptResult } from "./select"

// ── Re-export theme helpers for other modules ──
export { getTheme, fg, bg, ansi, colored, bold, dim, italic, underline, reset } from "./theme"

// ── Role → OpenTUI text color ──
const ROLE_FG: Record<string, string> = {
  pm:        "#A5D6FF",
  "pm-header": "#58A6FF",
  coder:     "#3FB950",
  intern:    "#E3B341",
  user:      "#E6EDF3",
  system:    "#8B949E",
  reasoning: "#6E7681",
  command:   "#BC8CFF",
  warning:   "#D29922",
  error:     "#F85149",
  success:   "#3FB950",
}

// ── Module state ──
let renderer: any
let scrollBox: ScrollBoxRenderable
let pmStatusText: TextRenderable
let internStatusText: TextRenderable
let coderText: TextRenderable
let inputComp: TextareaRenderable
let pendingResolve: ((s: string) => void) | null = null
let childCount = 0
let pmAbortCtrl: AbortController | null = null
let coderAbortCtrl: AbortController | null = null

function setTerminalTitle(title: string) {
  try {
    process.title = title
    process.stdout.write(`\x1b]0;${title}\x07`)
  } catch {}
}

// Plain-text message ring buffer for /copy command
const messageLog: string[] = []
const MAX_LOG = 200

// ── PM markdown syntax style ──
const mdStyle = SyntaxStyle.fromStyles({
  "markup.heading":   { fg: RGBA.fromHex("#58A6FF"), bold: true },
  "markup.heading.1": { fg: RGBA.fromHex("#58A6FF"), bold: true },
  "markup.heading.2": { fg: RGBA.fromHex("#58A6FF"), bold: true },
  "markup.heading.3": { fg: RGBA.fromHex("#79C0FF"), bold: true },
  "markup.bold":      { fg: RGBA.fromHex("#58A6FF"), bold: true },
  "markup.italic":    { fg: RGBA.fromHex("#79C0FF"), italic: true },
  "markup.list":      { fg: RGBA.fromHex("#58A6FF") },
  "markup.raw":       { fg: RGBA.fromHex("#79C0FF") },
  "markup.raw.block": { fg: RGBA.fromHex("#79C0FF") },
  "markup.link":      { fg: RGBA.fromHex("#58A6FF"), underline: true },
  "markup.quote":     { fg: RGBA.fromHex("#8B949E"), italic: true },
  "markup.table":     { fg: RGBA.fromHex("#C9D1D9") },
  "markup.table.header": { fg: RGBA.fromHex("#58A6FF"), bold: true },
  keyword:    { fg: RGBA.fromHex("#FF7B72"), bold: true },
  string:     { fg: RGBA.fromHex("#A5D6FF") },
  function:   { fg: RGBA.fromHex("#D2A8FF") },
  type:       { fg: RGBA.fromHex("#FFA657") },
  number:     { fg: RGBA.fromHex("#79C0FF") },
  comment:    { fg: RGBA.fromHex("#8B949E"), italic: true },
  variable:   { fg: RGBA.fromHex("#E6EDF3") },
  property:   { fg: RGBA.fromHex("#79C0FF") },
  operator:   { fg: RGBA.fromHex("#FF7B72") },
  punctuation:{ fg: RGBA.fromHex("#C9D1D9") },
  constant:   { fg: RGBA.fromHex("#79C0FF") },
  default:    { fg: RGBA.fromHex("#C9D1D9") },
})

// ═══════════════════════════════════════════════════════════════
// Init
// ═══════════════════════════════════════════════════════════════

export async function init() {
  setTerminalTitle("TeamCode")
  renderer = await createCliRenderer({
    screenMode: "alternate-screen",
    exitOnCtrlC: false,
    targetFps: 30,
    useMouse: true,
    consoleOptions: {
      keyBindings: [
        { name: "y", ctrl: true, action: "copy-selection" },
        { name: "c", ctrl: true, shift: true, action: "copy-selection" },
      ],
      onCopySelection(text: string) {
        copyToClipboard(text).catch(() => {})
      },
    },
  })

  renderer.console.onCopySelection = (text: string) => {
    if (text) copyToClipboard(text).catch(() => {})
  }

  // Fallback: if OpenTUI's copy-selection returns empty, try getSelection
  const origOnCopy = renderer.console.onCopySelection
  renderer.console.onCopySelection = (text: string) => {
    if (text && text.trim()) {
      copyToClipboard(text.trim()).catch(() => {})
      return
    }
    // Fallback: try the selection API directly
    try {
      const sel = (renderer as any).getSelection?.()
      const selText = sel?.getSelectedText?.()
      if (selText && selText.trim()) {
        copyToClipboard(selText.trim()).catch(() => {})
      }
    } catch {}
  }

  // ═══ ScrollBox (message area) — padding on wrapper box ═══
  scrollBox = new ScrollBoxRenderable(renderer, {
    id: "content", flexGrow: 1, stickyScroll: true, minHeight: 0,
  })

  // Opening banner
  scrollBox.add(makeText("TeamCode — Committee Coding", "pm-header"))

  // ═══ PM status (left, blue) ─────────────────────────────── ═══
  pmStatusText = new TextRenderable(renderer, {
    content: "PM: idle",
    fg: ROLE_FG["pm-header"],  // #58A6FF — standard PM blue
    attributes: TextAttributes.BOLD,
    flexShrink: 0,
  })

  // ═══ Intern status (left, gold) ─────────────────────────── ═══
  internStatusText = new TextRenderable(renderer, {
    content: "",
    fg: ROLE_FG.intern,  // #E3B341 — warm gold
    attributes: TextAttributes.BOLD,
    flexShrink: 0,
  })

  // ═══ Coder status (right, green) ───────────────────────── ═══
  coderText = new TextRenderable(renderer, {
    content: "Coder: idle",
    fg: ROLE_FG.coder,  // #3FB950 — standard coder green
    attributes: TextAttributes.BOLD,
    flexShrink: 0,
  })

  // ═══ Status row ─────────────────────────────────────────── ═══
  const statusRow = new BoxRenderable(renderer, {
    flexDirection: "row", flexShrink: 0,
    justifyContent: "space-between",
    paddingLeft: 1, paddingRight: 1,
    gap: 2,
  })
  statusRow.add(pmStatusText)
  statusRow.add(internStatusText)
  statusRow.add(coderText)

  // ═══ Divider lines ──────────────────────────────────────── ═══
  const dividerTop = makeText("─".repeat(process.stdout.columns || 80), "system")
  const dividerBot = makeText("─".repeat(process.stdout.columns || 80), "system")

  // ═══ Input: TextareaRenderable (OpenCode pattern) ─────────── ═══
  // InputRenderable hardcodes height:1 + wrapMode:none + strips \n.
  // Use TextareaRenderable directly for native multi-line soft-wrap.
  const promptPrefix = new TextRenderable(renderer, {
    content: "❯ ",
    fg: ROLE_FG["pm-header"],
    attributes: TextAttributes.BOLD,
    flexShrink: 0,
  })

  inputComp = new TextareaRenderable(renderer, {
    id: "user-input", flexGrow: 1,
    placeholder: "Type a message or /command...",
    textColor: ROLE_FG.user,
    focusedTextColor: ROLE_FG.user,
    minHeight: 1,
    maxHeight: 6,
    // Enter → submit, Ctrl+J → newline (terminal can't distinguish Ctrl+Enter from Enter)
    keyBindings: [
      { name: "return", action: "submit" },
    ],
    onSubmit: () => {
      const text = ((inputComp as any).plainText ?? "").trim()
      if (text && pendingResolve) {
        const r = pendingResolve; pendingResolve = null
        try { inputComp.clear() } catch {}
        r(text)
      }
    },
  } as any)


  const inputRow = new BoxRenderable(renderer, {
    flexDirection: "row", flexShrink: 0,
    paddingLeft: 1, paddingRight: 1,
  })
  inputRow.add(promptPrefix)
  inputRow.add(inputComp)

  // ═══ Footer assembly ───────────────────────────────────── ═══
  const footer = new BoxRenderable(renderer, {
    flexShrink: 0, flexDirection: "column",
  })
  footer.add(dividerTop)
  footer.add(statusRow)
  footer.add(dividerBot)
  footer.add(inputRow)

  // ═══ Content area ──────────────────────────────────────── ═══
  const contentArea = new BoxRenderable(renderer, {
    flexGrow: 1, flexDirection: "column", minHeight: 0,
    paddingLeft: 1, paddingRight: 1,
  })
  contentArea.add(scrollBox)

  // ═══ Root ═══
  const root = new BoxRenderable(renderer, {
    id: "root", flexDirection: "column", flexGrow: 1, minHeight: 0,
  })
  root.add(contentArea)
  root.add(footer)
  renderer.root.add(root)

  // ═══ ESC → interrupt PM only (Coder runs independently) ═══
  renderer.keyInput.on("keypress", (key: any) => {
    if (key?.name === "escape") {
      if (pmAbortCtrl) {
        pmAbortCtrl.abort()
        pmAbortCtrl = null
      }
      if (pendingResolve) {
        const r = pendingResolve; pendingResolve = null; r("")
      }
    }
  })

  // ═══ Selection finished → copy to clipboard ═══
  renderer.on("selection", () => {
    try {
      const sel = (renderer as any).getSelection?.()
      const text = sel?.getSelectedText?.()
      if (text) {
        copyToClipboard(text).catch(() => {})
        ;(renderer as any).clearSelection?.()
      }
    } catch {}
  })

  setTimeout(() => { try { inputComp.focus() } catch {} }, 150)
}

export function cleanup() {
  setTerminalTitle(process.platform === "win32" ? "PowerShell" : "Shell")
  try { renderer?.destroy() } catch {}
}

// ═══════════════════════════════════════════════════════════════
// Header — multi-colored row layout
// ═══════════════════════════════════════════════════════════════

export function renderHeader(rows: { text: string; color?: string; bold?: boolean }[][]): void {
  if (!renderer || !scrollBox) return
  for (const row of rows) {
    const rowBox = new BoxRenderable(renderer, {
      flexDirection: "row", flexShrink: 0, gap: 0,
    })
    for (const seg of row) {
      const attrs = seg.bold ? TextAttributes.BOLD : TextAttributes.NONE
      rowBox.add(new TextRenderable(renderer, {
        content: seg.text,
        fg: seg.color ?? ROLE_FG.system,
        attributes: attrs,
        selectable: false,
        flexShrink: 0,
      }))
    }
    scrollBox.add(rowBox)
    childCount++
  }
  refocusInput()
}

// ═══════════════════════════════════════════════════════════════
// Write message to scroll box
// ═══════════════════════════════════════════════════════════════

export function write(rawText: string, role?: string) {
  if (!rawText) return

  // Log to ring buffer for /copy
  messageLog.push(stripAnsi(rawText))
  if (messageLog.length > MAX_LOG) messageLog.shift()

  if (role === "pm") {
    const clean = stripAnsi(rawText).trim()
    if (!clean) return
    scrollBox.add(new MarkdownRenderable(renderer, {
      content: clean,
      syntaxStyle: mdStyle,
      width: Math.min((process.stdout.columns || 80) - 4, 116),
      conceal: true,
      concealCode: false,
      tableOptions: { style: "grid", borderColor: "#30363D", cellPadding: 1 },
      id: `msg-${childCount++}`,
    } as any))
    refocusInput()
    return
  }

  // ── Non-PM: one selectable TextRenderable per line ──
  const fg = ROLE_FG[role ?? ""] ?? ROLE_FG.system
  const attrs =
    role === "pm-header" || role === "coder" ? TextAttributes.BOLD
    : role === "warning" ? TextAttributes.BOLD
    : role === "reasoning" ? TextAttributes.DIM | TextAttributes.ITALIC
    : role === "system" ? TextAttributes.DIM
    : TextAttributes.NONE

  const text = role === "user" ? rawText.replace(/\n+$/, "") : rawText

  for (const line of text.split("\n")) {
    scrollBox.add(new TextRenderable(renderer, {
      content: line || " ",
      fg,
      attributes: attrs,
      wrapMode: "word",
      selectable: true,
      id: `msg-${childCount++}`,
    }))
  }

  refocusInput()
}

function refocusInput() {
  if (pendingResolve !== null) {
    setTimeout(() => { try { inputComp.focus() } catch {} }, 10)
  }
}

function makeText(content: string, role: string): TextRenderable {
  const fg = ROLE_FG[role] ?? ROLE_FG.system
  const attrs = role === "pm-header" || role === "coder" ? TextAttributes.BOLD
    : role === "system" ? TextAttributes.DIM
    : TextAttributes.NONE
  return new TextRenderable(renderer, {
    content, fg, attributes: attrs, selectable: true,
  })
}

// ═══════════════════════════════════════════════════════════════
// Status bar helpers
// ═══════════════════════════════════════════════════════════════

// Update PM status text (left side of status row, PM blue)
export function setPmStatus(s: string) {
  try { pmStatusText.content = s } catch {}
}

// Update Intern status text (left side of status row, gold)
export function setInternStatus(s: string) {
  try { internStatusText.content = s } catch {}
}

// Update Coder status text (right side of status row, Coder green)
export function setCoderStatus(s: string) {
  try { coderText.content = s } catch {}
}

export function readInput(): Promise<string> {
  return new Promise((resolve) => {
    pendingResolve = resolve
    try { inputComp.focus() } catch {}
  })
}

// Create a new abort signal for PM (replaces any previous PM signal)
export function pmAbortSignal(): AbortSignal {
  pmAbortCtrl?.abort()
  pmAbortCtrl = new AbortController()
  return pmAbortCtrl.signal
}

export function clearPmAbort() { pmAbortCtrl = null }

// Create a new abort signal for Coder (independent from PM)
export function coderAbortSignal(): AbortSignal {
  coderAbortCtrl?.abort()
  coderAbortCtrl = new AbortController()
  return coderAbortCtrl.signal
}

export function clearCoderAbort() { coderAbortCtrl = null }

// Interactive selection prompt (wraps selectPrompt with our renderer)
export function showSelect(
  title: string,
  options: SelectOption[],
  message?: string,
): Promise<SelectPromptResult | null> {
  return selectPrompt(renderer, title, options, message)
}

// Copy messages to system clipboard (used by /copy command)
// range: { start: 1, end: 50 } means "most-recent 1st through most-recent 50th"
export async function copyMessages(range?: { start: number; end: number }): Promise<string> {
  const total = messageLog.length
  if (total === 0) return "Nothing to copy"

  const start = range?.start ?? 1
  const end = range?.end ?? 50

  const fromIdx = Math.max(0, total - end)
  const toIdx = Math.max(0, total - start + 1)
  const selected = messageLog.slice(fromIdx, toIdx)

  const text = selected.join("\n")
  if (text.trim()) {
    await copyToClipboard(text)
    return `Copied ${selected.length} messages to clipboard`
  }
  return "Nothing to copy"
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
}

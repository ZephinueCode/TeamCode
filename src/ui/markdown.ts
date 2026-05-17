/**
 * Markdown → ANSI terminal renderer.
 *
 * Converts a subset of markdown to ANSI escape codes for terminal display.
 * Supports: headings, bold, italic, code spans, fenced code blocks, lists,
 * blockquotes, horizontal rules, and inline links.
 *
 * Inspired by OpenCode's markdown rendering pipeline (OpenTUI markdown component).
 * Does NOT use tree-sitter — uses regex-based syntax for code blocks.
 */
import { getTheme, fg, ansi, type Theme } from "./theme"

// ── Syntax highlighting (regex-based, light) ──

const TS_KEYWORDS = /\b(import|export|from|const|let|var|function|class|interface|type|enum|if|else|return|async|await|yield|new|this|extends|implements|readonly|static|public|private|protected|throw|try|catch|finally|switch|case|default|break|continue|for|while|do|in|of|typeof|instanceof|as|is|asserts)\b/g
const TS_STRING = /(["'`])(?:(?!\1)[^\\]|\\.)*\1/g
const TS_NUMBER = /\b\d+\.?\d*\b/g
const TS_COMMENT = /\/\/.*$|\/\*[\s\S]*?\*\//gm
const TS_FUNCTION = /\b([a-zA-Z_$][\w$]*)\s*\(/g
const TS_TYPE = /\b([A-Z][\w$]*)\b/g

function highlightCode(code: string, lang: string): string {
  const t = getTheme()

  let out = code

  // Comments first (so they don't get re-highlighted)
  out = out.replace(TS_COMMENT, (m) => fg(t.syntax.comment) + m + ansi(0))

  // Strings
  out = out.replace(TS_STRING, (m) => fg(t.syntax.string) + m + ansi(0))

  // Keywords
  out = out.replace(TS_KEYWORDS, (m) => fg(t.syntax.keyword) + ansi(1) + m + ansi(22) + ansi(0))

  // Numbers
  out = out.replace(TS_NUMBER, (m) => fg(t.syntax.number) + m + ansi(0))

  // Function calls
  out = out.replace(TS_FUNCTION, (_, name) => fg(t.syntax.function) + name + ansi(0) + "(")

  // Type names (Capitalized)
  out = out.replace(TS_TYPE, (m) => fg(t.syntax.type) + m + ansi(0))

  return out
}

// ── Markdown to ANSI ──

export function renderMarkdown(text: string, width: number = 80): string {
  const t = getTheme()
  const lines = text.split("\n")
  const result: string[] = []

  let inCodeBlock = false
  let codeLang = ""
  let codeLines: string[] = []
  let inBlockquote = false
  let listPrefix = ""

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!

    // Fenced code blocks
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        // End code block
        result.push(renderCodeFrame(codeLines.join("\n"), codeLang, width))
        codeLines = []
        inCodeBlock = false
        codeLang = ""
      } else {
        inCodeBlock = true
        codeLang = line.slice(3).trim()
      }
      continue
    }
    if (inCodeBlock) {
      codeLines.push(line)
      continue
    }

    // Blockquote
    if (line.startsWith("> ")) {
      const content = inlineFormat(line.slice(2), t)
      result.push(fg(t.dim) + "│ " + ansi(0) + fg(t.dim) + content + ansi(0))
      continue
    }

    // Headings
    if (line.startsWith("#### ")) {
      result.push(ansi(1) + fg(t.primary) + line.slice(5) + ansi(0))
      continue
    }
    if (line.startsWith("### ")) {
      result.push(ansi(1) + fg(t.primary) + "▸ " + line.slice(4) + ansi(0))
      continue
    }
    if (line.startsWith("## ")) {
      result.push("")
      result.push(ansi(1) + fg(t.primary) + "◆ " + line.slice(3) + ansi(0))
      continue
    }
    if (line.startsWith("# ")) {
      result.push("")
      result.push(ansi(1) + fg(t.primary) + "⬢ " + line.slice(2) + ansi(0))
      result.push(ansi(2) + "─".repeat(Math.min(width, 60)) + ansi(0))
      continue
    }

    // Horizontal rule
    if (line.match(/^[-*_]{3,}$/)) {
      result.push(ansi(2) + "─".repeat(Math.min(width, 60)) + ansi(0))
      continue
    }

    // Table — buffer consecutive |...| lines
    if (line.startsWith("|") && line.endsWith("|")) {
      const tableLines: string[] = [line]
      while (i + 1 < lines.length) {
        const next = lines[i + 1]!
        if (next.startsWith("|") && next.endsWith("|")) { tableLines.push(next); i++ }
        else break
      }
      if (tableLines.length >= 2) {
        result.push(renderTable(tableLines, t))
      } else {
        result.push(inlineFormat(line, t))
      }
      continue
    }

    // Unordered list
    const ulMatch = line.match(/^(\s*)[-*+]\s+(.*)/)
    if (ulMatch) {
      const indent = Math.floor((ulMatch[1]?.length ?? 0) / 2)
      const prefix = "  ".repeat(indent) + fg(t.secondary) + "•" + ansi(0)
      result.push(prefix + " " + inlineFormat(ulMatch[2]!, t))
      continue
    }

    // Ordered list
    const olMatch = line.match(/^(\s*)\d+\.\s+(.*)/)
    if (olMatch) {
      const indent = Math.floor((olMatch[1]?.length ?? 0) / 2)
      const prefix = "  ".repeat(indent) + fg(t.secondary) + "◦" + ansi(0)
      result.push(prefix + " " + inlineFormat(olMatch[2]!, t))
      continue
    }

    // Empty line
    if (!line.trim()) {
      result.push("")
      continue
    }

    // Regular paragraph
    result.push(inlineFormat(line, t))
  }

  // Close any open code block
  if (codeLines.length > 0) {
    result.push(renderCodeFrame(codeLines.join("\n"), codeLang, width))
  }

  return result.join("\n")
}

// ── Code frame rendering (replicates OpenCode's <code> component) ──

function renderCodeFrame(code: string, lang: string, width: number): string {
  const t = getTheme()
  const highlighted = highlightCode(code, lang)
  const lines = highlighted.split("\n")
  const maxLineNum = lines.length
  const gutterWidth = String(maxLineNum).length + 2

  const header = lang
    ? fg(t.dim) + "┌─ " + fg(t.syntax.comment) + lang + fg(t.dim) + " ───" + ansi(0)
    : fg(t.dim) + "┌───" + ansi(0)

  const result = [header]

  for (let i = 0; i < lines.length; i++) {
    const num = String(i + 1).padStart(gutterWidth - 1, " ")
    const gutter = fg(t.dim) + "│" + ansi(0) + fg(t.dim) + " " + num + " " + ansi(0)
    result.push(gutter + lines[i])
  }

  result.push(fg(t.dim) + "└" + "─".repeat(Math.min(width - 2, 40)) + ansi(0))
  return result.join("\n")
}

// ── Inline formatting ──

function inlineFormat(text: string, t: Theme): string {
  let out = text

  // Bold (**text**)
  out = out.replace(/\*\*(.+?)\*\*/g, ansi(1) + "$1" + ansi(22))

  // Italic (*text*)
  out = out.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, ansi(3) + "$1" + ansi(23))

  // Inline code (`text`)
  out = out.replace(/`([^`]+)`/g, fg(t.syntax.string) + "$1" + ansi(0))

  // Links [text](url) — render as text
  out = out.replace(/\[([^\]]+)\]\([^)]+\)/g, ansi(4) + "$1" + ansi(24))

  // Strikethrough
  out = out.replace(/~~(.+?)~~/g, ansi(9) + "$1" + ansi(29))

  return out
}

// ── Table rendering ──

function parseTableRow(line: string): string[] {
  return line
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim())
}

function isSeparatorRow(row: string[]): boolean {
  return row.every((c) => /^:?-{3,}:?$/.test(c))
}

function renderTable(lines: string[], t: Theme): string {
  if (lines.length < 2) return lines.join("\n")

  const parsed = lines.map(parseTableRow)

  // Find separator row
  let sepIdx = parsed.findIndex(isSeparatorRow)
  if (sepIdx === -1) sepIdx = 1 // assume second row is separator

  const header = parsed.slice(0, sepIdx)
  const body = parsed.slice(sepIdx + 1)
  const allRows = [...header, ...body]

  if (allRows.length === 0) return ""

  // Calculate column widths
  const colCount = Math.max(...allRows.map((r) => r.length))
  const colWidths: number[] = Array(colCount).fill(3)
  for (const row of allRows) {
    for (let c = 0; c < row.length; c++) {
      colWidths[c] = Math.max(colWidths[c] ?? 3, stripAnsiForLen(row[c]!).length + 2)
    }
  }

  // Alignments from separator
  const aligns: ("l" | "r")[] = []
  if (sepIdx < parsed.length) {
    const sep = parsed[sepIdx]!
    for (let c = 0; c < colCount; c++) {
      const cell = sep[c] ?? ""
      const right = cell.startsWith("-:") || (cell.startsWith(":") && !cell.endsWith(":"))
      aligns[c] = right ? "r" : "l"
    }
  }

  function padCell(text: string, w: number, align: "l" | "r"): string {
    const raw = stripAnsiForLen(text)
    const pad = w - raw.length
    return align === "r" ? " ".repeat(pad) + text : text + " ".repeat(pad)
  }

  function renderRow(row: string[], isHeader: boolean): string {
    const cells = []
    for (let c = 0; c < colCount; c++) {
      const cell = row[c] ?? ""
      const formatted = isHeader ? ansi(1) + fg(t.primary) + cell + ansi(0) : inlineFormat(cell, t)
      cells.push(padCell(formatted, colWidths[c] ?? 10, aligns[c] ?? "l"))
    }
    const border = fg(t.dim) + "│" + ansi(0)
    return border + " " + cells.join(" " + border + " ") + " " + border
  }

  const result: string[] = []
  const topBorder = fg(t.dim) + "┌" + colWidths.map((w) => "─".repeat(w + 2)).join("┬") + "┐" + ansi(0)
  const sepBorder = fg(t.dim) + "├" + colWidths.map((w) => "─".repeat(w + 2)).join("┼") + "┤" + ansi(0)
  const botBorder = fg(t.dim) + "└" + colWidths.map((w) => "─".repeat(w + 2)).join("┴") + "┘" + ansi(0)

  result.push(topBorder)
  for (let i = 0; i < header.length; i++) {
    result.push(renderRow(header[i]!, true))
  }
  if (body.length > 0) result.push(sepBorder)
  for (let i = 0; i < body.length; i++) {
    result.push(renderRow(body[i]!, false))
  }
  result.push(botBorder)

  return result.join("\n")
}

function stripAnsiForLen(s: string): string {
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
}

// ── Diff rendering (replicates OpenCode's <diff> component) ──

export function renderDiff(diffText: string): string {
  const t = getTheme()
  return diffText
    .split("\n")
    .map((line) => {
      if (line.startsWith("+")) return fg(t.success) + line + ansi(0)
      if (line.startsWith("-")) return fg(t.error) + line + ansi(0)
      if (line.startsWith("@@")) return fg(t.primary) + line + ansi(0)
      return fg(t.dim) + line + ansi(0)
    })
    .join("\n")
}

// ── Tool output formatting ──

export function renderToolOutput(toolName: string, output: string): string {
  const t = getTheme()
  if (output.length > 2000) {
    output = output.slice(0, 2000) + fg(t.dim) + "\n... [truncated]" + ansi(0)
  }
  return output
}

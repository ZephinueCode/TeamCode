/**
 * Theme system — replicates OpenCode's theme JSON approach.
 *
 * Themes are JSON files under ~/.teamcode/themes/*.json
 * The default is derived from the terminal's 16 ANSI colors.
 *
 * Color references support:
 *   - Hex: "#4A90D9"
 *   - ANSI 256: "color(33)"
 *   - Named refs: "$primary" → resolved from defs
 *   - Terminal palette: "ansi.blue", "ansi.brightBlue"
 */
import * as fs from "fs/promises"
import path from "path"
import os from "os"

export interface Theme {
  name: string
  background: string
  foreground: string
  primary: string
  secondary: string
  error: string
  warning: string
  success: string
  dim: string
  // Agent identity colors
  pm: string
  coder: string
  intern: string
  user: string
  // Syntax highlighting
  syntax: {
    keyword: string
    string: string
    function: string
    type: string
    number: string
    comment: string
    property: string
    operator: string
  }
  // UI chrome
  border: string
  headerBg: string
  footerBg: string
  panelDivider: string
  selection: string
  cursor: string
}

// ── Built-in themes ──

export const darkDefault: Theme = {
  name: "dark-default",
  background: "#0D1117",
  foreground: "#C9D1D9",
  primary: "#58A6FF",
  secondary: "#3FB950",
  error: "#F85149",
  warning: "#D29922",
  success: "#3FB950",
  dim: "#484F58",
  pm: "#4A90D9",
  coder: "#50C878",
  intern: "#8B949E",
  user: "#FFFFFF",
  syntax: {
    keyword: "#FF7B72",
    string: "#A5D6FF",
    function: "#D2A8FF",
    type: "#FFA657",
    number: "#79C0FF",
    comment: "#8B949E",
    property: "#79C0FF",
    operator: "#FF7B72",
  },
  border: "#30363D",
  headerBg: "#161B22",
  footerBg: "#161B22",
  panelDivider: "#30363D",
  selection: "#1F6FEB",
  cursor: "#F0F6FC",
}

export const lightDefault: Theme = {
  ...darkDefault,
  name: "light-default",
  background: "#FFFFFF",
  foreground: "#24292F",
  primary: "#0969DA",
  secondary: "#1A7F37",
  error: "#CF222E",
  warning: "#9A6700",
  success: "#1A7F37",
  dim: "#6E7781",
  pm: "#0550AE",
  coder: "#1A7F37",
  intern: "#57606A",
  user: "#24292F",
  syntax: {
    keyword: "#CF222E",
    string: "#0A3069",
    function: "#8250DF",
    type: "#953800",
    number: "#0550AE",
    comment: "#6E7781",
    property: "#0550AE",
    operator: "#CF222E",
  },
  border: "#D0D7DE",
  headerBg: "#F6F8FA",
  footerBg: "#F6F8FA",
  panelDivider: "#D0D7DE",
  selection: "#0969DA",
  cursor: "#24292F",
}

// ── Resolver ──

function hexToAnsi(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return [r, g, b]
}

function ansi256(r: number, g: number, b: number): number {
  if (r === g && g === b) {
    if (r < 8) return 16
    if (r > 248) return 231
    return Math.round(((r - 8) / 247) * 24) + 232
  }
  return 16 + 36 * Math.round(r / 255 * 5) + 6 * Math.round(g / 255 * 5) + Math.round(b / 255 * 5)
}

export function fg(hex: string): string {
  const [r, g, b] = hexToAnsi(hex)
  return `\x1b[38;5;${ansi256(r, g, b)}m`
}

export function bg(hex: string): string {
  const [r, g, b] = hexToAnsi(hex)
  return `\x1b[48;5;${ansi256(r, g, b)}m`
}

export function ansi(code: number): string {
  return `\x1b[${code}m`
}

export function colored(text: string, hex: string): string {
  return fg(hex) + text + ansi(0)
}

// ── Theme loading ──

let currentTheme: Theme = darkDefault

export function getTheme(): Theme {
  return currentTheme
}

export function setTheme(t: Theme) {
  currentTheme = t
}

export async function loadTheme(name: string): Promise<Theme | undefined> {
  // Check built-ins
  if (name === "dark-default") return darkDefault
  if (name === "light-default") return lightDefault

  // Check custom themes on disk
  const dir = path.join(os.homedir(), ".teamcode", "themes")
  try {
    const files = await fs.readdir(dir)
    const match = files.find((f) => f === `${name}.json` || f === `${name}.theme.json`)
    if (match) {
      const text = await fs.readFile(path.join(dir, match), "utf-8")
      const loaded = JSON.parse(text) as Partial<Theme>
      return { ...darkDefault, ...loaded, name }
    }
  } catch {}

  return undefined
}

export function bold(text: string): string { return ansi(1) + text + ansi(22) }
export function dim(text: string): string { return ansi(2) + text + ansi(22) }
export function italic(text: string): string { return ansi(3) + text + ansi(23) }
export function underline(text: string): string { return ansi(4) + text + ansi(24) }
export function reset(): string { return ansi(0) }

export async function listThemes(): Promise<string[]> {
  const builtins = ["dark-default", "light-default"]
  const dir = path.join(os.homedir(), ".teamcode", "themes")
  try {
    const files = await fs.readdir(dir)
    const customs = files
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.(theme\.)?json$/, ""))
    return [...builtins, ...customs]
  } catch {
    return builtins
  }
}

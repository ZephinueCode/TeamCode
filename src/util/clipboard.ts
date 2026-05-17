/**
 * Clipboard utility — multi-layered clipboard copy following OpenCode's approach.
 *
 * Layer 1: OSC 52 escape sequence (works over SSH, supported by modern terminals)
 * Layer 2: Platform-native commands (PowerShell / osascript / wl-copy / xclip)
 */

import { spawn } from "cross-spawn"

function writeStdin(cmd: string[], text: string): Promise<void> {
  return new Promise((resolve) => {
    const child = spawn(cmd[0]!, cmd.slice(1), { stdio: ["pipe", "ignore", "ignore"] })
    child.stdin?.end(text)
    child.on("close", () => resolve())
    child.on("error", () => resolve())
  })
}

// Layer 1: OSC 52 — works in any modern terminal, even over SSH
function writeOsc52(text: string): void {
  if (!process.stdout.isTTY) return
  const base64 = Buffer.from(text).toString("base64")
  const osc52 = `\x1b]52;c;${base64}\x07`
  // Wrap for tmux/screen passthrough
  const passthrough = process.env["TMUX"] || process.env["STY"]
  const sequence = passthrough ? `\x1bPtmux;\x1b${osc52}\x1b\\` : osc52
  process.stdout.write(sequence)
}

// Layer 2: Native platform clipboard
async function copyNative(text: string): Promise<void> {
  const os = process.platform

  if (os === "win32") {
    // PowerShell clipboard via stdin (avoids string interpolation issues)
    const script = "[Console]::InputEncoding = [System.Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())"
    await writeStdin(["powershell.exe", "-NonInteractive", "-NoProfile", "-Command", script], text)
    return
  }

  if (os === "darwin") {
    const escaped = text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
    await new Promise<void>((resolve) => {
      const child = spawn("osascript", ["-e", `set the clipboard to "${escaped}"`], { stdio: "ignore" })
      child.on("close", () => resolve())
      child.on("error", () => resolve())
    })
    return
  }

  if (os === "linux") {
    // Try wl-copy (Wayland)
    const hasWl = process.env["WAYLAND_DISPLAY"]
    if (hasWl) {
      try {
        await writeStdin(["wl-copy"], text)
        return
      } catch {}
    }
    // Try xclip (X11)
    try {
      await writeStdin(["xclip", "-selection", "clipboard"], text)
      return
    } catch {}
    // Try xsel (X11 fallback)
    try {
      await writeStdin(["xsel", "--clipboard", "--input"], text)
    } catch {}
  }
}

export async function copy(text: string): Promise<void> {
  if (!text) return
  // Fire OSC 52 synchronously (no wait needed)
  writeOsc52(text)
  // Then platform-native copy
  try {
    await copyNative(text)
  } catch {
    // OSC 52 already fired, native copy is best-effort
  }
}

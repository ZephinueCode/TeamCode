/**
 * Config persistence — writes runtime changes back to disk.
 * On /apikey or /baseurl, the value is written to ~/.teamcode/teamcode.jsonc
 * so it survives restarts without needing env vars.
 */
import * as fs from "fs/promises"
import path from "path"
import os from "os"
import { modify, applyEdits, parse } from "jsonc-parser"

const CONFIG_DIR = path.join(os.homedir(), ".teamcode")
const CONFIG_FILE = path.join(CONFIG_DIR, "teamcode.jsonc")

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function persistConfig(patch: Record<string, any>): Promise<void> {
  try {
    await fs.mkdir(CONFIG_DIR, { recursive: true })

    let text: string
    try { text = await fs.readFile(CONFIG_FILE, "utf-8") } catch { text = "{}" }

    let updated = text
    // Walk the patch tree and set each leaf value at its full JSON path
    function walk(obj: unknown, path: string[]) {
      if (typeof obj === "object" && obj !== null && !Array.isArray(obj)) {
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
          if (typeof v === "object" && v !== null && !Array.isArray(v)) {
            walk(v, [...path, k])
          } else {
            const edits = modify(updated, [...path, k], v, {
              formattingOptions: { insertSpaces: true, tabSize: 2 },
            })
            updated = applyEdits(updated, edits)
          }
        }
      }
    }
    walk(patch, [])

    await fs.writeFile(CONFIG_FILE, updated, "utf-8")
  } catch (e) {
    console.warn("Failed to persist config:", e instanceof Error ? e.message : String(e))
  }
}

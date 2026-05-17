/**
 * Interactive selection prompt — modal overlay for user choices.
 *
 * Follows OpenCode's DialogConfirm pattern:
 *   - Title + ESC hint header
 *   - Optional message body
 *   - Arrow key navigation between options
 *   - Enter to confirm, ESC to cancel
 *   - Active option highlighted with accent color
 *
 * Reusable for any "pick one of N" interaction.
 */
import {
  BoxRenderable, TextRenderable, TextAttributes,
} from "@opentui/core"

export interface SelectOption {
  label: string
  value: string
}

export interface SelectPromptResult {
  value: string
  index: number
}

const ACCENT = "#58A6FF"
const MUTED = "#8B949E"
const TEXT = "#E6EDF3"

export function selectPrompt(
  renderer: any,
  title: string,
  options: SelectOption[],
  message?: string,
): Promise<SelectPromptResult | null> {
  return new Promise((resolve) => {
    let selectedIndex = 0
    let resolved = false

    function finish(result: SelectPromptResult | null) {
      if (resolved) return
      resolved = true
      // Cleanup key listener
      try {
        if (typeof renderer.keyInput?.off === "function") renderer.keyInput.off("keypress", onKey)
        else if (typeof renderer.keyInput?.removeListener === "function") renderer.keyInput.removeListener("keypress", onKey)
      } catch {}
      // Remove overlay from render tree
      try {
        const parent = root.parent
        if (parent && typeof parent.remove === "function") parent.remove(root.id)
      } catch {}
      resolve(result)
    }

    // ── Build overlay ──
    const root = new BoxRenderable(renderer, {
      id: "select-overlay",
      flexShrink: 0, flexDirection: "column",
      paddingLeft: 2, paddingRight: 2, paddingTop: 1, paddingBottom: 1,
    })

    // Header row: title | esc hint
    const titleText = new TextRenderable(renderer, {
      content: title,
      fg: TEXT,
      attributes: TextAttributes.BOLD,
    })
    const escHint = new TextRenderable(renderer, {
      content: "esc to cancel",
      fg: MUTED,
    })
    const headerRow = new BoxRenderable(renderer, {
      flexDirection: "row", justifyContent: "space-between", flexShrink: 0,
    })
    headerRow.add(titleText)
    headerRow.add(escHint)
    root.add(headerRow)

    // Separator
    root.add(new TextRenderable(renderer, {
      content: "─".repeat(Math.min(process.stdout.columns ?? 80, 80)),
      fg: MUTED,
      attributes: TextAttributes.DIM,
    }))

    // Message (optional)
    if (message) {
      root.add(new TextRenderable(renderer, {
        content: message,
        fg: MUTED,
        paddingTop: 1,
      }))
      root.add(new TextRenderable(renderer, { content: "", fg: MUTED }))
    }

    // Option labels
    const optionLabels: TextRenderable[] = []

    function refreshOptions() {
      for (let i = 0; i < optionLabels.length; i++) {
        const label = optionLabels[i]!
        const isActive = i === selectedIndex
        label.content = (isActive ? "▶ " : "  ") + options[i]!.label
        label.fg = isActive ? ACCENT : TEXT
        label.attributes = isActive ? TextAttributes.BOLD : TextAttributes.NONE
      }
    }

    // Use a horizontal row for <=2 options, vertical list for >2
    if (options.length <= 2) {
      const btnRow = new BoxRenderable(renderer, {
        flexDirection: "row", gap: 4, flexShrink: 0, paddingTop: 1,
      })
      for (let i = 0; i < options.length; i++) {
        const label = new TextRenderable(renderer, {
          content: (i === 0 ? "▶ " : "  ") + options[i]!.label,
          fg: i === 0 ? ACCENT : TEXT,
          attributes: i === 0 ? TextAttributes.BOLD : TextAttributes.NONE,
        })
        optionLabels.push(label)
        btnRow.add(label)
      }
      root.add(btnRow)
    } else {
      const listBox = new BoxRenderable(renderer, {
        flexDirection: "column", gap: 0, flexShrink: 0, paddingTop: 1,
      })
      for (let i = 0; i < options.length; i++) {
        const label = new TextRenderable(renderer, {
          content: (i === 0 ? "▶ " : "  ") + options[i]!.label,
          fg: i === 0 ? ACCENT : TEXT,
          attributes: i === 0 ? TextAttributes.BOLD : TextAttributes.NONE,
        })
        optionLabels.push(label)
        listBox.add(label)
      }
      root.add(listBox)
    }

    // Hint row
    root.add(new TextRenderable(renderer, {
      content: "← → to choose · Enter to confirm · Esc to cancel",
      fg: MUTED,
      attributes: TextAttributes.DIM,
      paddingTop: 1,
    }))

    // ── Key handler ──
    function onKey(key: any) {
      if (key?.name === "escape") {
        finish(null)
        return
      }
      if (key?.name === "return" || key?.name === "enter") {
        finish({ value: options[selectedIndex]!.value, index: selectedIndex })
        return
      }
      // Arrow keys for <=2 options: left/right. For >2: up/down
      if (options.length <= 2) {
        if (key?.name === "left" || key?.name === "h") {
          selectedIndex = selectedIndex > 0 ? selectedIndex - 1 : options.length - 1
          refreshOptions()
        }
        if (key?.name === "right" || key?.name === "l") {
          selectedIndex = selectedIndex < options.length - 1 ? selectedIndex + 1 : 0
          refreshOptions()
        }
      } else {
        if (key?.name === "up" || key?.name === "k") {
          selectedIndex = selectedIndex > 0 ? selectedIndex - 1 : options.length - 1
          refreshOptions()
        }
        if (key?.name === "down" || key?.name === "j") {
          selectedIndex = selectedIndex < options.length - 1 ? selectedIndex + 1 : 0
          refreshOptions()
        }
      }
      // Number keys for quick select
      const num = parseInt(key?.name ?? "", 10)
      if (!isNaN(num) && num >= 1 && num <= options.length) {
        selectedIndex = num - 1
        refreshOptions()
      }
    }

    renderer.keyInput.on("keypress", onKey)

    // ── Mount between content area and footer ──
    try {
      const rootBox = renderer.root.getChildren()?.[0] // the main "root" BoxRenderable
      if (rootBox && typeof rootBox.add === "function") {
        const children = rootBox.getChildren?.() ?? []
        // Remove any existing select overlay
        const existing = children.find((c: any) => c?.id === "select-overlay")
        if (existing && typeof rootBox.remove === "function") rootBox.remove(existing.id)
        // Insert before the footer (which is the last child: position children.length - 1)
        const insertAt = Math.max(1, (children.length || 1) - 1)
        rootBox.add(root, insertAt)
      }
    } catch {
      // Best-effort mount
    }
  })
}

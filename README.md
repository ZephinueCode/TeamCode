# TeamCode

**Committee-mode AI coding harness** — three models collaborate as PM, Coder, and Intern to produce higher-quality code than any single model can alone.

PM plans, Coder reviews and writes, Intern researches. Async execution means you keep chatting while code is being written.

## Updates

- 2026-5-17 v0.2.0: Various bug fixes & quality of lift updates
- 2026-5-17 v0.1.0: Initial version

## Why TeamCode?

Single-model coding agents suffer from confirmation bias — the same model that writes code also reviews it. TeamCode splits these roles across independent models:

- **PM** (product manager) — reads the codebase via Intern, produces a concrete plan, submits to Coder
- **Coder** (engineer) — reviews the plan critically, pushes back when it has issues, then executes
- **Intern** (scout) — fast, cheap subagent that absorbs the cost of bulk file reading

Result: plans get challenged before code is written, implementation is verified after each file, and context stays lean.

TeamCode is **Specifically optimized** edge development scenarios (e.g. DGX Spark), with medium-sized models, low bandwidth, but relatively voluminous VRAM capacity.

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) >= 1.x
- An OpenAI-compatible API endpoint (DashScope, OpenAI, vLLM, LiteLLM, etc.)

### Install

```bash
git clone https://github.com/ZephinueCode/TeamCode.git
cd teamcode
bun install
```

### Configure

Copy and edit the included `teamcode.jsonc`:

```jsonc
{
  "models": {
    "pm": {
      "provider": "openai-compatible",
      "model": "qwen3.6-plus",
      "endpoint": "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "apiKey": "${TEAMCODE_PM_API_KEY}"
    },
    "coder": {
      "provider": "openai-compatible",
      "model": "qwen3.6-plus",
      "endpoint": "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "apiKey": "${TEAMCODE_CODER_API_KEY}"
    },
    "intern": {
      "provider": "openai-compatible",
      "model": "qwen3.6-plus",
      "endpoint": "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "apiKey": "${TEAMCODE_INTERN_API_KEY}"
    }
  }
}
```

Each model can target a different provider, model, or API key. The Intern is optional — if omitted, it falls back to the PM model.

### Run

```bash
# Start a committee session in the current directory
bun run dev

# With a custom config
bun run dev --config ./my-project/teamcode.jsonc

# Install first, start anywhere
./install.sh # Linux / MacOS
./install.ps1 # Windows
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│                    TeamCode                      │
│  ┌─────────┐   ┌─────────┐   ┌──────────────┐   │
│  │   PM    │──▶│  Coder  │◀──│   Intern     │   │
│  │ planner │   │ builder │   │   scout      │   │
│  │ read    │   │ r/w/sh  │   │   read-only  │   │
│  └────┬────┘   └────┬────┘   └──────┬───────┘   │
│       │plan         │code           │research    │
│       ▼             ▼               ▼            │
│  ┌─────────────────────────────────────────┐     │
│  │            Committee Protocol            │     │
│  │  plan → review → deliberate → execute   │     │
│  └─────────────────────────────────────────┘     │
│                       │                          │
│                       ▼                          │
│  ┌─────────────────────────────────────────┐     │
│  │              TUI (OpenTUI)               │     │
│  │  async chat · status bar · /commands     │     │
│  └─────────────────────────────────────────┘     │
└─────────────────────────────────────────────────┘
```

### The Committee Protocol

| Phase | Who | What |
|---|---|---|
| **PM Planning** | PM | Discovers files via glob/grep, dispatches Intern for reading, produces a concrete plan |
| **Coder Review** | Coder | Verifies plan against the codebase, agrees or pushes back with specific changes |
| **Deliberation** | PM + Coder | Debate until consensus (max 3 rounds) |
| **Awaiting Approval** | User | Interactive select: Approve / Reject / Edit |
| **Execution** | Coder (async) | Writes all files in plan while user continues chatting with PM |
| **PM Review** | PM (async) | Reviews each file change via Intern, steers Coder if implementation deviates |

### Tools by Role

| Tool | PM | Coder | Intern |
|---|---|---|---|
| `read` | ⚠️ 1-2 lines only | ✅ | ✅ |
| `glob` | ✅ | ✅ | ✅ |
| `grep` | ✅ | ✅ | ✅ |
| `ls` | ✅ | ✅ | — |
| `write` | — | ✅ | — |
| `edit` | — | ✅ | — |
| `shell` | — | ✅ | — |
| `task` (dispatch Intern) | ✅ | ✅ | — |
| `submit_to_coder` | ✅ | — | — |
| `steer` | ✅ | — | — |

### Async Execution & PM Auto-Review

When the Coder starts writing files, it runs in a forked background fiber. You can continue chatting with the PM while code is being generated.

If PM auto-review is enabled (`/pmreview true`, default), each file the Coder writes triggers an automatic pipeline:

```
Coder writes file → Intern reads it → compares to plan → if deviation → Steer → Coder corrects → continues
```

## Configuration

### `teamcode.jsonc`

```jsonc
{
  "models": {
    "pm":   { "provider": "openai-compatible", "model": "...", "endpoint": "...", "apiKey": "..." },
    "coder":{ "provider": "openai-compatible", "model": "...", "endpoint": "...", "apiKey": "..." },
    "intern":{ "provider": "openai-compatible", "model": "...", "endpoint": "...", "apiKey": "..." }
  },
  "committee": {
    "deliberation": { "maxRounds": 3 },
    "execution":    { "pmReview": "async", "maxReviewRounds": 2, "coderAutonomy": "full" },
    "compaction":   { "auto": true, "contextLimit": 128000, "reservedTokens": 20000 }
  },
  "permission": {
    "pm":     { "read": "allow", "glob": "allow", "grep": "allow", "shell": "deny", "write": "deny", "edit": "deny" },
    "coder":  { "*": "allow" },
    "intern": { "read": "allow", "glob": "allow", "grep": "allow", "shell": "deny", "write": "deny", "edit": "deny", "task": "deny" }
  }
}
```

### Environment Variables

| Variable | Purpose |
| --- | --- |
| `TEAMCODE_PM_API_KEY` | PM model API key |
| `TEAMCODE_CODER_API_KEY` | Coder model API key |
| `TEAMCODE_INTERN_API_KEY` | Intern model API key |
| `TEAMCODE_API_KEY` | Shared API key (fallback for all three) |
| `TEAMCODE_CONFIG` | Path to `teamcode.jsonc` |

All keys can also be set inline in the config file or via the `/apikey` slash command.

## Slash Commands

| Command | Description |
| --- | --- |
| `/help` | Show all commands |
| `/apikey sk-...` | Set API key for all models |
| `/baseurl https://...` | Set API endpoint for all models |
| `/model pm\|coder\|intern <name>` | Change model per agent |
| `/review` | Submit PM discussion to Coder for review |
| `/copy [N]` | Copy last N messages to system clipboard |
| `/pmreview true\|false` | Toggle PM auto-review during execution |
| `/maxinterns N` | Set max parallel Intern dispatches (default 1) |
| `/compact` | Force context compaction |
| `/theme dark\|light` | Switch terminal theme |
| `/status` | Show committee status and progress |
| `/plan` | Show current plan |
| `/exit` | Quit |

## Recommended Models

TeamCode is model-agnostic — any OpenAI-compatible endpoint works.

| Role | Recommendation | Why |
| --- | --- | --- |
| **PM** | Qwen3.6-Plus, GPT-5.5, Claude Sonnet | Balance between reasoning and speed |
| **Coder** | Qwen3.6-Coder, GPT-5.5-Pro, Claude Opus | Code generation quality |
| **Intern** | Qwen3.6-4B, GPT-5.5-Instant, Claude Haiku | Fast and cheap — only reads files |

The Intern is the most constrained role — it only reads and summarizes. A 4B model is likely sufficient.

## Development

```bash
bun install        # Install dependencies
bun run dev        # Start TeamCode
bun run typecheck  # Type check
bun test           # Run tests
```

### Tech Stack

| Layer | Technology |
| --- | --- |
| Runtime | [Bun](https://bun.sh/) |
| Language | TypeScript |
| LLM SDK | [Vercel AI SDK](https://sdk.vercel.ai/) |
| TUI | [OpenTUI](https://github.com/opentui/opentui) |
| Effects & Concurrency | [Effect](https://effect.website/) |
| Config | JSONC with env var interpolation |

## License

Developed upon OpenCode (MIT) and OpenTUI (MIT).

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

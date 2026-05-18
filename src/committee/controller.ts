/**
 * Committee Controller — central orchestrator for TeamCode.
 *
 * All visual formatting is handled by tui.ts (OpenTUI props: fg, attributes, paddingLeft).
 * This module only passes plain text + role to write().
 *
 * Role guide:
 *   "pm"        → markdown body (MarkdownRenderable)
 *   "pm-header" → bold blue header line
 *   "coder"     → bold green text
 *   "user"      → user message echo
 *   "system"    → dim grey (tool output, status, etc.)
 *   "command"   → purple (slash command output)
 *   "warning"   → bold yellow
 *   "error"     → red
 */
import { Cause, Effect, Stream } from "effect"
import { randomUUID } from "crypto"
import * as fs from "fs/promises"
import path from "path"
import { spawn } from "cross-spawn"
import type { ModelMessage } from "ai"
import { Service as ProviderSvc, type ModelHandle } from "../provider/provider"
import { Service as LLMService, type StreamEvent } from "../llm/llm"
import { Service as ToolRegistrySvc } from "../tool/registry"
import { Service as SessionSvc } from "../session/session"
import { Service as ConfigSvc } from "../config/config"
import { Service as SnapshotSvc } from "../snapshot/snapshot"
import { type Def as ToolDef } from "../tool/tool"
import { toAITool } from "../llm/llm"
import { buildEnvironment, buildCommitteeContext } from "../session/system"
import { detectConsensus, nextPhase, type CommitteePhase, type PlanArtifact, type ReviewArtifact, type CoderProgress } from "./protocol"
import { buildCompactionPrompt } from "./compaction"
import * as Tui from "../ui/tui"
import { runtimeConfig } from "../config/runtime"
import { matchCommands } from "../ui/commands"
import { evaluate, fromConfig, type Ruleset } from "../permission/permission"

// ── Output helpers ──
function w(text: string, role?: string) { Tui.write(text, role) }

function userEcho(text: string): string {
  const preview = text.length > 100 ? text.slice(0, 100) + "..." : text
  return "You: " + preview
}

interface CoderExecutionStats {
  writeSuccess: number
  writeFailed: number
  text: string
  aborted: boolean
  error?: string
  failedActions: string[]
}

// ── Committee runner ──

export function runCommittee(opts?: {
  sessionID?: string
  onActivity?: (e: { type: string; icon: string; label: string; detail?: string; status: string; agent: string }) => void
}) {
  return Effect.gen(function* () {
    const provider = yield* ProviderSvc
    const llm = yield* LLMService
    const tools = yield* ToolRegistrySvc
    const session = yield* SessionSvc
    const configSvc = yield* ConfigSvc
    const snapshot = yield* SnapshotSvc
    const onActivity = opts?.onActivity

    const cfg = yield* configSvc.get()
    const cwd = process.cwd()
    const emit = (type: string, icon: string, label: string, detail?: string, status = "done", agent = "system") =>
      onActivity?.({ type, icon, label, detail, status, agent })

    yield* snapshot.init()
    const resumedSession = opts?.sessionID ? yield* session.get(opts.sessionID) : undefined
    const mainSession = resumedSession ?? (yield* session.create({ title: "Committee session", agent: "pm", directory: cwd, modelProvider: "pm", modelID: cfg.models.pm.model }))
    if (resumedSession) w(`◆ Resumed session ${resumedSession.id}`, "pm-header")
    else w(`◆ Session ${mainSession.id}`, "system")

    const getPmModel = () => provider.pm
    const getCoderModel = () => provider.coder
    const getInternModel = () => provider.intern

    // ── State (must be declared before envs that reference them) ──
    let pmReviewEnabled = true
    let maxInterns = 1
    let coderIsExecuting = false
    let yoloMode = false

    const pmEnv = [...buildEnvironment(cwd, cwd), buildCommitteeContext("pm", maxInterns)]
    const coderEnv = [...buildEnvironment(cwd, cwd), buildCommitteeContext("coder", maxInterns)]
    const internEnv = [...buildEnvironment(cwd, cwd), buildCommitteeContext("intern", maxInterns)]

    const allToolDefs = yield* tools.all()
    const pmToolDefs = allToolDefs.filter((t) => ["read", "glob", "grep", "ls", "task", "submit_to_coder", "steer"].includes(t.id))
    const coderToolDefs = allToolDefs.filter((t) => !["submit_to_coder", "steer"].includes(t.id))
    const internToolDefs = allToolDefs.filter((t) => ["read", "glob", "grep"].includes(t.id))
    const permissionRules: Record<string, Ruleset> = {
      pm: fromConfig(cfg.permission?.pm ?? {}),
      coder: fromConfig(cfg.permission?.coder ?? {}),
      intern: fromConfig(cfg.permission?.intern ?? {}),
    }
    const rememberedPermission = new Set<string>()
    let permissionQueue: Promise<void> = Promise.resolve()

    // Tracks submit_to_coder tool calls from PM → triggers phase transition
    let submittedPlan: { summary: string; approach: string } | null = null

    // PM auto-review + Steer state (continued)
    const steerQueue: Array<{ file: string; feedback: string; severity: string }> = []
    let currentCoderExecution: CoderExecutionStats | null = null

    // ── Intern dispatch ──
    function dispatchIntern(description: string, prompt: string): Effect.Effect<string> {
      return Effect.gen(function* () {
        internDescription = description.length > 30 ? description.slice(0, 30) + "…" : description
        emit("intern-dispatch", "⚡", `Intern: ${description}`, prompt.slice(0, 80), "running", "intern")
        const stream = llm.stream({
          sessionID: "intern-" + randomUUID().slice(0, 8),
          agent: { name: "intern", temperature: 0.1 },
          model: yield* getInternModel(),
          system: internEnv,
          messages: [{ role: "user", content: `Research task: ${description}\n\n${prompt}\n\nBe fast and concise. Report facts only.` } as any],
          tools: buildTools(internToolDefs, "intern"),
          maxOutputTokens: cfg.models.intern?.maxTokens ?? 4096,
        })
        const result = yield* collectText(stream, "intern")
        internDescription = ""
        emit("intern-dispatch", "⚡", "Intern done", result.slice(0, 80), "done", "intern")
        return result
      })
    }

    // ── PM auto-review: after Coder writes a file, Intern checks it against the plan ──
    function reviewFile(filePath: string): Effect.Effect<void> {
      return Effect.gen(function* () {
      if (!pmReviewEnabled || !plan) return
      emit("file-review", "🔍", `PM reviewing ${filePath.slice(-40)}`, "", "running", "pm")

      const internResult = yield* dispatchIntern(
        `Review: ${filePath}`,
        [
          `Read the file "${filePath}" and compare its implementation to this plan:`,
          `Summary: ${plan.summary}`,
          `Approach: ${plan.approach}`,
          ``,
          `Answer with EXACTLY one of:`,
          `- "OK" if the implementation matches the plan`,
          `- "STEER: <specific feedback>" if it deviates — describe exactly what needs to change`,
        ].join("\n"),
      )

      if (internResult.includes("STEER:")) {
        const feedback = internResult.replace(/^STEER:\s*/i, "").trim()
        steerQueue.push({ file: filePath, feedback, severity: "must_fix" })
        w(`⚡ PM: Issue found in ${filePath.slice(-30)} — steering Coder`, "warning")
        w(`   ${feedback.slice(0, 120)}`, "system")
      } else {
        w(`✓ PM: ${filePath.slice(-30)} reviewed — OK`, "success")
      }
      })
    }

    function permissionTarget(defID: string, args: any): string {
      if (defID === "shell") return String(args?.command ?? "*")
      return String(args?.filePath ?? args?.path ?? args?.pattern ?? args?.description ?? "*")
    }

    async function requestToolPermission(label: string, defID: string, args: any): Promise<boolean> {
      if (yoloMode) return true

      const target = permissionTarget(defID, args)
      const key = `${label}:${defID}:${target}`
      const rules = permissionRules[label] ?? []
      const decision = evaluate(defID, target, rules)

      if (decision.action === "deny") {
        w(`Permission denied by config: ${label}.${defID} ${target.slice(0, 80)}`, "warning")
        return false
      }
      if (rememberedPermission.has(key)) return true

      const message = [
        `Agent: ${label}`,
        `Tool: ${defID}`,
        `Target: ${target}`,
      ].join("  ·  ")
      let result: any = null
      const ask = permissionQueue.then(async () => {
        result = await Tui.showSelect("Approve Tool Call", [
          { label: "Yes", value: "yes" },
          { label: "Yes, don't ask", value: "always" },
          { label: "No", value: "no" },
        ], message)
      })
      permissionQueue = ask.then(() => {}, () => {})
      await ask

      if (!result || result.value === "no") {
        w(`Permission denied: ${label}.${defID} ${target.slice(0, 80)}`, "warning")
        return false
      }
      if (result.value === "always") rememberedPermission.add(key)
      return true
    }

    function recordCoderWriteResult(defID: string, args: any, ok: boolean, metadata: Record<string, unknown> = {}) {
      if (!coderIsExecuting || (defID !== "write" && defID !== "edit")) return
      const filePath = String(args?.filePath ?? "")
      const pathLabel = filePath || "(unknown file)"

      if (ok) {
        coderFilesDone++
        currentCoderExecution && currentCoderExecution.writeSuccess++
        if (filePath && !coderProgress.completedFiles.includes(filePath)) coderProgress.completedFiles.push(filePath)
        coderActions.push({
          tool: defID,
          path: filePath,
          summary: String(metadata.title ?? `${defID} ${pathLabel}`).slice(0, 80),
          ts: Date.now(),
        })
        return
      }

      currentCoderExecution && currentCoderExecution.writeFailed++
      currentCoderExecution?.failedActions.push(`${defID} ${pathLabel}: ${String(metadata.error ?? metadata.denied ?? "failed")}`)
      if (!coderProgress.failedFiles.includes(pathLabel)) coderProgress.failedFiles.push(pathLabel)
    }

    function buildTools(defs: ToolDef[], label: string): Record<string, any> {
      const result: Record<string, any> = {}
      for (const def of defs) {
        result[def.id] = toAITool(def, async (args, callID) => {
          const argPath = (args as any)?.filePath ?? (args as any)?.pattern ?? (args as any)?.command ?? ""

          const allowed = await requestToolPermission(label, def.id, args as any)
          if (!allowed) {
            if (label === "coder") recordCoderWriteResult(def.id, args as any, false, { error: "permission_denied" })
            return {
              output: `Permission denied for ${label}.${def.id}. Ask the user to approve the action or use a different approach.`,
              title: `${def.id} denied`,
              metadata: { denied: true, agent: label },
            }
          }

          if (label === "coder") {
            coderLastAction = def.id + " " + String(argPath).slice(0, 40)

            // ── Check steer queue before write/edit ──
            if (def.id === "write" || def.id === "edit") {
              const filePath = (args as any)?.filePath ?? ""
              const pendingSteer = steerQueue.shift()
              if (pendingSteer) {
                // Inject steer feedback as a note the Coder sees before writing
                (args as any)._steerNote = pendingSteer.feedback
                w(`⚡ Coder applying steer: ${pendingSteer.file.slice(-30)}`, "warning")
                w(`   ${pendingSteer.feedback.slice(0, 120)}`, "system")
              }
            }
          }

          // ── Tool call rendering (OpenCode-style) ──
          const toolTitle = def.id
            + (argPath ? " " + String(argPath).slice(0, 50) : "")
            + ((args as any)?.summary ? ": " + (args as any).summary.slice(0, 60) : "")

          if (label !== "coder") {
            w("─".repeat(40), "system")
            w("🔧 " + toolTitle, "system")
          }

          // Check for steer tool → add to steer queue
          if (def.id === "steer") {
            const file = (args as any)?.file ?? ""
            const feedback = (args as any)?.feedback ?? ""
            const severity = (args as any)?.severity ?? "suggestion"
            steerQueue.push({ file, feedback, severity })
            w(`⚡ Steer queued for ${file.slice(-40)}`, "warning")
          }

          // Check for task → dispatch Intern subagent
          if (def.id === "task") {
            const taskDesc = String((args as any)?.description ?? "research")
            const taskPrompt = String((args as any)?.prompt ?? "")
            // Always intercept — the task tool is just a stub for Intern dispatch
            try {
              const internResult = await Effect.runPromise(
                dispatchIntern(taskDesc, taskPrompt)
              )
              return {
                output: internResult,
                title: `Intern: ${taskDesc.slice(0, 80)}`,
                metadata: { subagent: "intern", description: taskDesc },
              }
            } catch (err: any) {
              return {
                output: `Intern failed: ${err?.message ?? String(err)}`,
                title: `Intern error: ${taskDesc.slice(0, 60)}`,
                metadata: { error: err?.message ?? String(err) },
              }
            }
          }

          try {
            const ctx = { sessionID: "", messageID: "", agent: def.id, abort: new AbortController().signal, callID, messages: [], metadata: () => Effect.void, ask: () => Effect.void }
            const r = await Effect.runPromise(def.execute(args, ctx))
            if (label !== "coder" && r.output) {
              w("✓ " + String(r.output).slice(0, 120).replace(/\n/g, " "), "system")
            }

            if (def.id === "submit_to_coder" && r.metadata?.submitted === true) {
              submittedPlan = {
                summary: String(r.metadata.summary ?? ""),
                approach: String(r.metadata.approach ?? ""),
              }
            }

            // ── Log Coder actions for execution compaction ──
            if (label === "coder" && coderIsExecuting) {
              const actionPath = def.id === "task"
                ? String((args as any)?.description ?? "").slice(0, 40)
                : argPath
              const isWriteEdit = def.id === "write" || def.id === "edit"
              const ok = !r.metadata?.error && !r.metadata?.denied
              if (isWriteEdit) {
                recordCoderWriteResult(def.id, args as any, ok, { ...r.metadata, title: r.title })
              } else {
                coderActions.push({
                  tool: def.id,
                  path: actionPath,
                  summary: r.title.slice(0, 80),
                  ts: Date.now(),
                })
              }
            }

            // ── After Coder writes a file → fork PM auto-review (execution only) ──
            if (label === "coder" && (def.id === "write" || def.id === "edit") && coderIsExecuting && !r.metadata?.error && !r.metadata?.denied) {
              const filePath = (args as any)?.filePath ?? ""
              if (filePath && pmReviewEnabled && plan) {
                Effect.runFork(reviewFile(filePath))
              }
            }

            return { output: r.output, title: r.title, metadata: r.metadata }
          } catch (err: any) {
            const msg = err?.message ?? String(err)
            if (label !== "coder") w("✗ " + msg.slice(0, 80), "error")
            if (label === "coder") recordCoderWriteResult(def.id, args as any, false, { error: msg })
            return { output: "Tool error: " + msg, title: def.id + " error", metadata: { error: msg } }
          }
        })
      }
      return result
    }

    // ── Token tracking ──
    let totalTokensUsed = 0
    let needsCompaction = false
    let contextLimit = cfg.committee?.compaction?.contextLimit ?? 200_000
    const OVERFLOW_RATIO = cfg.committee?.compaction?.overflowRatio ?? 0.85

    function overflowThreshold() { return Math.floor(contextLimit * OVERFLOW_RATIO) }
    function isOverflow() { return contextLimit > 0 && totalTokensUsed >= overflowThreshold() }

    function isAborted(err: unknown): boolean {
      return err instanceof Error && (err.name === "AbortError" || err.message?.includes("abort"))
    }

    let reasoningBuffer = ""   // accumulated reasoning, shown only via /think
    function collectText(s: Stream.Stream<StreamEvent, Error>, agent: string): Effect.Effect<string> {
      return Effect.gen(function* () {
        let text = ""
        reasoningBuffer = ""
        let streamError = ""
        if (agent === "pm") { pmThinking = true; pmStartedAt = Date.now(); pmTokens = 0 }
        if (agent === "intern") { internThinking = true; internStartedAt = Date.now() }
        yield* s.pipe(
          Stream.tap((e: any) => Effect.sync(() => {
            if (e?.type === "reasoning-delta") {
              reasoningBuffer += (e.text ?? "")
            }
            if (e?.type === "text-delta") {
              text += (e.text ?? "")
            }
            // ── Capture tool-call arguments so they appear in history ──
            if (e?.type === "tool-call") {
              const toolInput = (e as any).input ?? {}
              if ((e as any).toolName === "submit_to_coder" && toolInput.approach) {
                text += "\n\n[Plan submitted to Coder]\n" + String(toolInput.approach)
              }
            }
            if (e?.type === "finish-step" && (e as any).usage) {
              const u = (e as any).usage
              // stepInput is cumulative (includes all prior steps' context + output),
              // stepOutput is only this step's new output. Sum = total context consumed.
              const stepTotal = (u.inputTokens ?? 0) + (u.outputTokenDetails?.textTokens ?? u.outputTokens ?? 0)
              if (stepTotal > totalTokensUsed) {
                totalTokensUsed = stepTotal
                cmdCtx.state.tokenUsage = totalTokensUsed
              }
              if (agent === "pm" && stepTotal > pmTokens) pmTokens = stepTotal
              if (isOverflow()) needsCompaction = true
            }
          })),
          Stream.runDrain,
          Effect.catchCause((cause) => Effect.sync(() => {
            const err = Cause.squash(cause)
            streamError = isAborted(err) ? "ABORTED" : (err instanceof Error ? err.message : String(err))
          })),
        )
        if (agent === "pm") pmThinking = false
        if (agent === "intern") { internThinking = false; internStartedAt = 0 }
        if (streamError === "ABORTED") return "[ABORTED]"
        if (streamError) {
          w(`✗ ${agent} error: ${streamError.slice(0, 200)}`, "error")
          return `[Error: ${streamError}]`
        }
        return text || "[No response]"
      })
    }

    // Drain a Coder stream, tracking token usage and the real execution outcome.
    function drainCoderStream(s: Stream.Stream<any, any>): Effect.Effect<CoderExecutionStats> {
      return Effect.gen(function* () {
        const stats: CoderExecutionStats = currentCoderExecution ?? {
          writeSuccess: 0,
          writeFailed: 0,
          text: "",
          aborted: false,
          failedActions: [],
        }
        yield* s.pipe(
          Stream.tap((e: any) => Effect.sync(() => {
            if (e?.type === "text-delta") {
              stats.text += e.text ?? ""
            }
            if (e?.type === "finish-step" && (e as any).usage) {
              const u = (e as any).usage
              const stepTotal = (u.inputTokens ?? 0) + (u.outputTokenDetails?.textTokens ?? u.outputTokens ?? 0)
              if (stepTotal > totalTokensUsed) {
                totalTokensUsed = stepTotal
                cmdCtx.state.tokenUsage = totalTokensUsed
              }
              if (stepTotal > coderTokens) coderTokens = stepTotal
            }
          })),
          Stream.runDrain,
          Effect.catchCause((cause) => Effect.sync(() => {
            const err = Cause.squash(cause)
            if (isAborted(err)) {
              stats.aborted = true
              return
            }
            const msg = err instanceof Error ? err.message : String(err)
            stats.error = msg
            w(`✗ Coder execution error: ${msg.slice(0, 200)}`, "error")
          })),
        )
        return stats
      })
    }

    // ── Compaction ──
    const runCompaction = Effect.gen(function* () {
      const beforeTokens = estimateTokens(history)
      emit("compaction", "🔄", "Compaction starting", `${Math.round(beforeTokens / 1000)}k tokens`, "running", "system")

      const compactStream = llm.stream({
        sessionID: "compaction", agent: { name: "pm", temperature: 0.3 },
        model: yield* getPmModel(), system: pmEnv,
        messages: [{ role: "system", content: buildCompactionPrompt("pm", { plan, review, currentPhase: phase, completedFiles: coderProgress.completedFiles, failedFiles: coderProgress.failedFiles, pmMessages: history, coderMessages: [] }) }] as any,
        tools: {}, maxOutputTokens: 2048,
        abortSignal: Tui.pmAbortSignal(),
      })
      const summary = yield* collectText(compactStream, "pm")

      // ── Apply compaction: trim history, keep first + last, inject summary ──
      const compactionSystemMsg: ModelMessage = {
        role: "system",
        content: [
          "<compaction_result>",
          summary,
          "</compaction_result>",
          "",
          "Continue from where you left off. The user's intent and current state are preserved above.",
        ].join("\n"),
      }

      // Keep: first user message + compaction result + last 2 message pairs
      const firstUser = history.find((m) => m.role === "user")
      const recent = history.slice(-4)
      history.length = 0
      if (firstUser) history.push(firstUser)
      history.push(compactionSystemMsg)
      history.push(...recent)

      const afterTokens = estimateTokens(history)
      totalTokensUsed = afterTokens
      needsCompaction = false
      emit("compaction", "📦", "Compaction done", `${Math.round(beforeTokens / 1000)}k → ${Math.round(afterTokens / 1000)}k tokens`, "done", "system")
    })

    // ── Compaction trigger — checks flag set mid-stream ──
    const maybeCompact = Effect.gen(function* () {
      if (needsCompaction && cfg.committee?.compaction?.auto !== false) {
        w(`⚡ Context ${Math.round(totalTokensUsed / 1000)}k / ${Math.round(overflowThreshold() / 1000)}k (${Math.round(OVERFLOW_RATIO * 100)}%) → compacting...`, "warning")
        yield* runCompaction
      }
    })

    // ── State ──
    let phase: CommitteePhase = "idle"
    let plan: PlanArtifact | undefined
    let review: ReviewArtifact | undefined
    const coderProgress: CoderProgress = { currentFile: null, completedFiles: [], failedFiles: [], pmFeedback: [], internTasks: [] }
    // Coder execution action log — preserved across compaction restarts
    const coderActions: Array<{ tool: string; path: string; summary: string; ts: number }> = []
    const history: ModelMessage[] = []
    const persistedMessages = yield* session.messages(mainSession.id)
    for (const msg of persistedMessages) {
      const text = msg.parts
        .filter((p: any) => p.type === "text")
        .map((p: any) => p.text)
        .join("\n")
      if (text) history.push({ role: msg.role, content: text } as ModelMessage)
    }
    let coderSessionID: string | undefined

    function persistChat(role: "user" | "assistant", content: string, agent = "pm"): Effect.Effect<void> {
      const id = randomUUID()
      return session.appendMessage({
        id,
        role,
        sessionID: mainSession.id,
        agent,
        model: { providerID: agent, modelID: agent === "coder" ? cfg.models.coder.model : cfg.models.pm.model },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        time: { created: Date.now(), completed: Date.now() },
        finish: "stop",
        parts: [{
          type: "text",
          id: randomUUID(),
          sessionID: mainSession.id,
          messageID: id,
          text: content,
        }],
      } as any)
    }

    const cmdCtx = {
      state: {
        pmModel: cfg.models.pm.model, coderModel: cfg.models.coder.model, internModel: cfg.models.intern?.model,
        phase: "idle" as CommitteePhase, progress: coderProgress, compactionCount: 0, tokenUsage: 0, totalCost: 0,
        contextLimit: cfg.committee?.compaction?.contextLimit ?? 200000,
        currentPlan: undefined as PlanArtifact | undefined, theme: "dark-default", yolo: yoloMode,
      } as any, setState: () => {},
      dispatch: (a: string, payload?: unknown) => {
        if (a === "exit") { Tui.cleanup(); process.exit(0) }
        if (a === "submit_to_coder") {
          const pmMsgs = history.filter((m) => m.role === "assistant")
          const context = pmMsgs.slice(-3).map((m) => m.content).join("\n")
          plan = { summary: "User submitted via /review", approach: context || "Review the conversation above and produce a coding plan.", files: [], risks: [], alternatives: [] }
          w("◆ /review → Coder will review the conversation above", "pm-header")
          phase = "coder_review"
        }
        if (a === "copy") {
          const range = typeof payload === "number" ? { start: 1, end: payload } : (payload as { start: number; end: number }) ?? { start: 1, end: 50 }
          Tui.copyMessages(range).then((msg: string) => w(msg, "command")).catch(() => {})
        }
        if (a === "model_changed") { showHeader() }
        if (a === "pmreview") { pmReviewEnabled = payload as boolean; w(`PM auto-review: ${pmReviewEnabled ? "ON" : "OFF"}`, "command") }
        if (a === "yolo") { yoloMode = payload as boolean; cmdCtx.state.yolo = yoloMode; w(`YOLO mode: ${yoloMode ? "ON" : "OFF"}`, "command") }
        if (a === "maxinterns") { maxInterns = Math.max(1, (payload as number) || 1); w(`Max Intern batch: ${maxInterns}`, "command") }
        if (a === "set_context_limit") { contextLimit = (payload as number) || contextLimit; cmdCtx.state.contextLimit = contextLimit }
        if (a === "show_reasoning") {
          if (reasoningBuffer) {
            w("─".repeat(40), "system")
            w(reasoningBuffer, "reasoning")
            w("─".repeat(40), "system")
            reasoningBuffer = ""
          } else {
            w("(no reasoning yet this step)", "system")
          }
        }
        if (a === "stall_coder") {
          Tui.coderAbortSignal()      // abort running Coder stream + create fresh signal
          coderIsExecuting = false
          coderLastAction = "idle"
          coderStartedAt = 0
          w("⚡ Coder aborted by user.", "warning")
        }
        if (a === "force_planning") phase = "idle"
      },
    } as any

    async function missingPlannedFiles(): Promise<string[]> {
      const files = (plan?.files ?? [])
        .map((f) => f.path)
        .filter((p) => p && !p.includes("*"))
      const missing: string[] = []
      for (const file of files) {
        try {
          await fs.access(path.resolve(cwd, file))
        } catch {
          missing.push(file)
        }
      }
      return missing
    }

    // ── Header (re-callable to reflect model changes) ──
    function showHeader() {
      const pmCfg = runtimeConfig.get("pm", cfg.models.pm)
      const coderCfg = runtimeConfig.get("coder", cfg.models.coder)
      const internCfg = cfg.models.intern
      const internModel = internCfg?.endpoint && internCfg.model ? internCfg.model : pmCfg.model

      const maskKey = (k?: string) => {
        if (!k || k.length < 8) return "not set"
        return k.slice(0, 4) + "···" + k.slice(-4)
      }

      const base = pmCfg.endpoint ? pmCfg.endpoint.replace(/^https?:\/\//, "").replace(/\/v\d+$/, "") : "not set"
      const key = maskKey(pmCfg.apiKey)

      const W = Math.max(60, (process.stdout.columns || 80) - 4)
      const GAP = "    "

      Tui.renderHeader([
        [{ text: "─".repeat(W), color: "#30363D" }],
        [
          { text: "●", color: "#58A6FF" }, { text: " PM" + GAP, color: "#58A6FF", bold: true },
          { text: "●", color: "#3FB950" }, { text: " Coder" + GAP, color: "#3FB950", bold: true },
          { text: "●", color: "#E3B341" }, { text: " Intern", color: "#E3B341", bold: true },
        ],
        [
          { text: "PM: ", color: "#8B949E" }, { text: pmCfg.model, color: "#C9D1D9" },
          { text: GAP + "Coder: ", color: "#8B949E" }, { text: coderCfg.model, color: "#C9D1D9" },
          { text: GAP + "Intern: ", color: "#8B949E" }, { text: internModel, color: "#C9D1D9" },
        ],
        [
          { text: "Base: ", color: "#8B949E" }, { text: base, color: "#C9D1D9" },
          { text: GAP + "Key: ", color: "#8B949E" }, { text: key, color: "#C9D1D9" },
        ],
        [],
        [{ text: "/help", color: "#BC8CFF" }, { text: " for all commands", color: "#8B949E" }],
        [{ text: "─".repeat(W), color: "#30363D" }],
        [],
      ])
    }
    showHeader()

    // ── Footer status ──
    let coderLastAction = "idle"
    let coderFilesDone = 0
    let coderStartedAt = 0
    let coderTokens = 0
    let pmThinking = false
    let pmStartedAt = 0
    let pmTokens = 0
    let internThinking = false
    let internStartedAt = 0
    let internDescription = ""

    function updateTuiStatus() {
      const spin = ["⠋","⠙","⠹","⠸","⠼","⠴","⠦","⠧","⠇","⠏"][Math.floor(Date.now() / 200) % 10]!

      // PM status — left side, rendered in PM blue (#58A6FF) by tui.ts
      if (pmThinking && pmStartedAt > 0) {
        const elapsed = Math.floor((Date.now() - pmStartedAt) / 1000)
        const min = Math.floor(elapsed / 60); const sec = elapsed % 60
        const timeStr = min > 0 ? `${min}m ${sec}s` : `${sec}s`
        const tokStr = pmTokens > 0 ? ` · ${(pmTokens / 1000).toFixed(1)}k` : ""
        Tui.setPmStatus(spin + " PM: thinking" + tokStr + " · " + timeStr)
      } else {
        Tui.setPmStatus("PM: idle")
      }

      // Intern status — left side, rendered in gold (#E3B341) by tui.ts
      if (internThinking && internStartedAt > 0) {
        const elapsed = Math.floor((Date.now() - internStartedAt) / 1000)
        const min = Math.floor(elapsed / 60); const sec = elapsed % 60
        const timeStr = min > 0 ? `${min}m ${sec}s` : `${sec}s`
        Tui.setInternStatus(spin + " Intern: " + (internDescription || "reading") + " · " + timeStr)
      } else if (internDescription) {
        Tui.setInternStatus("⚡ Intern: " + internDescription)
      } else {
        Tui.setInternStatus("")
      }

      // Coder status — right side, rendered in Coder green (#3FB950) by tui.ts
      if (coderLastAction !== "idle") {
        let status = spin + " Coder: " + coderLastAction
        if (coderStartedAt > 0) {
          const elapsed = Math.floor((Date.now() - coderStartedAt) / 1000)
          const min = Math.floor(elapsed / 60); const sec = elapsed % 60
          status += " · " + (min > 0 ? `${min}m ${sec}s` : `${sec}s`)
        }
        if (coderTokens > 0) status += ` · ${(coderTokens / 1000).toFixed(1)}k`
        if (coderFilesDone > 0) status += "  files:" + coderFilesDone
        Tui.setCoderStatus(status)
      } else {
        Tui.setCoderStatus(spin + " Coder: idle")
      }
    }
    const tuiStatusTimer = setInterval(updateTuiStatus, 200)

    // ══════════════════════════════════════════════════════════
    // Main loop
    // ══════════════════════════════════════════════════════════

    while (true) {
      switch (phase) {

        case "idle": {
          const raw = yield* readUserInput()
          if (!raw.trim()) continue

          // ── Slash commands ──
          if (raw.startsWith("/")) {
            const cmdName = raw.split(/\s+/)[0]!.slice(1)
            const matches = matchCommands(raw, phase)
            const exact = matches.find((c) => c.name === cmdName)

            if (exact && (raw === "/" + exact.name || raw.startsWith("/" + exact.name + " "))) {
              const args = raw.slice(exact.name.length + 1).trim()
              w("")
              const result = exact.execute(args, cmdCtx) as string
              if (result) w(result, "command")
              if (exact.name === "exit") return
              continue
            }

            if (raw === "/") {
              w("Commands", "command")
              for (const c of matchCommands("/", phase)) w(`/${c.name}  ${c.description}`, "command")
              w("")
              continue
            }

            if (matches.length > 0) {
              w("Matching", "command")
              for (const m of matches) w(`/${m.name}  ${m.description}`, "command")
              w("")
              continue
            }

            w("Unknown command. /help for all commands.", "system")
            w("")
            continue
          }

          // ── PM chat ──
          history.push({ role: "user", content: raw })
          yield* persistChat("user", raw)
          w(userEcho(raw), "user")

          const pmTime = new Date().toLocaleTimeString()
          w("● PM · " + pmTime, "pm-header")
          w("─".repeat(40), "system")

          const SYSTEM_REMINDER = `You are the PM. Explore the codebase, produce a clear plan with specific files and changes, then call submit_to_coder. You cannot write or edit files — only the Coder does that.`

          const temp = runtimeConfig.get("pm", cfg.models.pm).temperature ?? 0.5
          const maxTok = runtimeConfig.get("pm", cfg.models.pm).maxTokens ?? 200000
          const pmStream = llm.stream({
            sessionID: "main", agent: { name: "pm", temperature: temp },
            model: yield* getPmModel(), system: pmEnv,
            messages: [...history, { role: "system" as const, content: SYSTEM_REMINDER }],
            tools: buildTools(pmToolDefs, "pm"), maxOutputTokens: maxTok,
            abortSignal: Tui.pmAbortSignal(),
          })
          const text = yield* collectText(pmStream, "pm")
          Tui.clearPmAbort()

          if (text === "[ABORTED]") {
            w("⏎ Interrupted by user", "warning")
            w("")
            continue
          }

          // PM body as markdown
          w(text, "pm")
          w("")
          history.push({ role: "assistant", content: text })
          yield* persistChat("assistant", text)

          yield* maybeCompact

          // submit_to_coder tool was called → transition to coder_review
          if (submittedPlan) {
            const sp: { summary: string; approach: string } = submittedPlan
            submittedPlan = null
            w("◆ Submitting to Coder for review...", "pm-header")
            w("")
            const parsed = parsePlan(sp.approach)
            plan = {
              summary: sp.summary,
              approach: sp.approach,
              files: parsed.files, risks: parsed.risks, alternatives: parsed.alternatives,
            }
            phase = "coder_review"
          }
          break
        }

        // ═════ coder_review ═════
        case "coder_review": {
          coderLastAction = "reviewing plan..."
          coderStartedAt = Date.now()
          emit("phase-enter", "🔍", "Coder reviewing", "", "running", "coder")

          w("◆ CODER — Reviewing Plan", "pm-header")
          w("─".repeat(40), "system")

          // Compact before handing context to Coder — review may read many files
          yield* maybeCompact

          const coderSess = yield* session.create({ parentID: "main", title: "Coder review", agent: "coder", directory: cwd, modelProvider: "coder", modelID: cfg.models.coder.model })
          coderSessionID = coderSess.id

          const coderMessages: ModelMessage[] = [
            ...history.slice(-6),
            { role: "system", content: "You are in review phase. Move fast — your goal is to catch blockers, not to perfect the plan. Spend 2-3 minutes max. Check 2-3 key files with grep/read, then decide." },
            { role: "user", content: `Review this plan:\n\n${plan?.approach || plan?.summary || "(see conversation above)"}\n\nBe decisive. Do not read exhaustively — spot-check file paths and approach. If the general direction is sound, approve it. Only push back on real problems (wrong file, missing edge case, architectural risk). Minor issues can be fixed during execution.\n\nOutput format:\nOverall: agree / agree_with_changes / disagree\nComments (blockers only, skip if none):\n- topic: your assessment — severity: blocker | suggestion` },
          ]

          const coderReviewStream = llm.stream({
            sessionID: coderSessionID, agent: { name: "coder", temperature: cfg.models.coder.temperature ?? 0.5 },
            model: yield* getCoderModel(), system: coderEnv, messages: coderMessages,
            tools: buildTools(coderToolDefs, "coder"), maxOutputTokens: cfg.models.coder.maxTokens ?? 200000,
            abortSignal: Tui.coderAbortSignal(),
          })
          const text = yield* collectText(coderReviewStream, "coder")
          Tui.clearCoderAbort()

          if (text === "[ABORTED]") {
            w("⏎ Review interrupted", "warning")
            w("")
            phase = "idle"
            break
          }

          yield* maybeCompact

          review = parseReview(text)
          w(text, "pm")
          w("")
          emit("phase-enter", "🔍", "Review done", review.overall, "done", "coder")

          if (review.overall === "disagree") {
            w("⚠ Coder disagrees — entering deliberation", "warning")
            phase = "deliberation" as CommitteePhase
          } else if (review.overall === "agree_with_changes" && review.suggestedChanges.length > 0) {
            w("⚡ Coder has suggestions — entering deliberation", "warning")
            phase = "deliberation" as CommitteePhase
          } else {
            phase = "awaiting_approval"
          }
          break
        }

        // ═════ deliberation ═════
        case "deliberation": {
          coderLastAction = "deliberating..."
          const maxRounds = cfg.committee?.deliberation?.maxRounds ?? 3
          let round = 0
          while (round < maxRounds) {
            round++
            emit("phase-enter", "💬", `Deliberation R${round}/${maxRounds}`, "", "running", "system")

            const pmStream = llm.stream({
              sessionID: "main", agent: { name: "pm" },
              model: yield* getPmModel(), system: pmEnv,
              messages: [{ role: "user", content: `Coder feedback:\n${JSON.stringify(review, null, 2)}\nRespond to each comment.` }],
              tools: buildTools(pmToolDefs, "pm"),
              abortSignal: Tui.pmAbortSignal(),
            })
            const pmResp = yield* collectText(pmStream, "pm")
            if (pmResp === "[ABORTED]") { phase = "idle"; break }
            yield* maybeCompact

            const coderStream = llm.stream({
              sessionID: coderSessionID ?? "coder", agent: { name: "coder" },
              model: yield* getCoderModel(), system: coderEnv,
              messages: [{ role: "user", content: `PM response:\n${pmResp}\nReply "CONSENSUS" or "DIVERGE: <remaining issues>".` }],
              tools: buildTools(coderToolDefs, "coder"),
              abortSignal: Tui.coderAbortSignal(),
            })
            const coderResp = yield* collectText(coderStream, "coder")
            Tui.clearCoderAbort()
            if (coderResp === "[ABORTED]") { phase = "idle"; break }

            history.push({ role: "assistant", content: pmResp })
            history.push({ role: "user", content: coderResp })
            yield* persistChat("assistant", pmResp)
            yield* persistChat("user", coderResp, "coder")

            yield* maybeCompact

            if (coderResp.startsWith("CONSENSUS")) { phase = "awaiting_approval"; break }
            if (round >= maxRounds) { phase = "awaiting_decision"; break }
          }
          break
        }

        // ═════ awaiting_approval ═════
        case "awaiting_approval": {
          const reviewVerdict = review?.overall === "disagree" ? "disagrees"
            : review?.overall === "agree_with_changes" ? "agrees with suggestions"
            : "approved"
          const planSummary = plan?.summary ?? "(plan ready)"
          w("") // spacing before modal

          const result = yield* Effect.promise(() =>
            Tui.showSelect("Plan Review", [
              { label: "Approve", value: "approve" },
              { label: "Reject", value: "reject" },
              { label: "Edit", value: "edit" },
            ], `Coder: ${reviewVerdict}  ·  ${planSummary}`),
          )

          if (!result) { w("Cancelled.", "system"); phase = "idle"; break }
          if (result.value === "approve") { phase = "executing" }
          else if (result.value === "reject") { w("Cancelled.", "system"); phase = "idle" }
          else {
            w("Enter your revision notes:", "system")
            const input = yield* readUserInput()
            history.push({ role: "user", content: `Revise: ${input}` })
            yield* persistChat("user", `Revise: ${input}`)
            phase = "idle"
          }
          break
        }

        // ═════ awaiting_decision ═════
        case "awaiting_decision": {
          w("") // spacing before modal

          const result = yield* Effect.promise(() =>
            Tui.showSelect("Stalemate", [
              { label: "Accept PM Plan", value: "pm" },
              { label: "Accept Coder Plan", value: "coder" },
              { label: "Edit & Retry", value: "edit" },
            ], "PM and Coder cannot agree. Choose whose plan to execute."),
          )

          if (!result) { phase = "idle"; break }
          if (result.value === "pm") { phase = "executing" }
          else if (result.value === "coder") { plan = { ...plan!, approach: plan!.approach + "\n[Adopted Coder suggestions]" }; phase = "executing" }
          else {
            w("Enter your guidance:", "system")
            const input = yield* readUserInput()
            history.push({ role: "user", content: input })
            yield* persistChat("user", input)
            coderLastAction = "idle"
            phase = "idle"
          }
          break
        }

        // ═════ executing (async) ═════
        case "executing": {
          w("◆ CODER — Executing (async)  You can keep chatting with PM", "pm-header")
          w("")
          emit("phase-enter", "🚀", "Coder executing", "async", "running", "coder")

          // Compact PM history before handing context to Coder — the Coder
          // needs headroom for reading files during execution.
          yield* maybeCompact

          // Always inject the plan explicitly — history may not contain it
          // after compaction, and the Coder needs precise instructions.
          const planText = plan?.approach || plan?.summary || "(implement the changes discussed)"
          const execMessages: ModelMessage[] = [
            ...history.slice(-4),
            { role: "system", content: `Plan to implement:\n${planText}\n\nExecution phase. Use write for new files, edit for changes. Read each file before editing. Write every file mentioned in the plan.` },
            { role: "user", content: "Execute the plan above. Call the write or edit tool for each file. Do NOT just describe the changes — actually call the tools." },
          ]

          coderIsExecuting = true

          const coderJob = Effect.gen(function* () {
            coderLastAction = "starting..."
            coderFilesDone = 0
            coderStartedAt = Date.now()
            w("◆ CODER executing (watch tools below)", "pm-header")

            coderActions.length = 0
            currentCoderExecution = { writeSuccess: 0, writeFailed: 0, text: "", aborted: false, failedActions: [] }
            const coderExecStream = llm.stream({
              sessionID: coderSessionID ?? "coder",
              agent: { name: "coder", temperature: cfg.models.coder.temperature ?? 0.5 },
              model: yield* getCoderModel(), system: coderEnv,
              messages: execMessages, tools: buildTools(coderToolDefs, "coder"),
              maxOutputTokens: cfg.models.coder.maxTokens ?? 200000,
              abortSignal: Tui.coderAbortSignal(),
            })
            const execResult = yield* drainCoderStream(coderExecStream)
            Tui.clearCoderAbort()

            const missingFiles = yield* Effect.promise(() => missingPlannedFiles())
            const canSummarize = !execResult.aborted && !execResult.error && execResult.writeSuccess > 0

            let summary = ""
            if (canSummarize) {
              coderLastAction = "summarizing..."
              coderStartedAt = Date.now()

              const actionSummary = coderActions
                .filter((a) => a.tool === "write" || a.tool === "edit")
                .map((a) => `- ${a.tool} ${a.path}: ${a.summary}`)
                .join("\n")
              const failedSummary = execResult.failedActions.map((a) => `- ${a}`).join("\n")

              // ── Coder summary — grounded only in successful tool actions ──
              const summaryStream = llm.stream({
                sessionID: coderSessionID ?? "coder",
                agent: { name: "coder", temperature: 0.3 },
                model: yield* getCoderModel(), system: coderEnv,
                messages: [
                  ...execMessages.slice(-3),
                  {
                    role: "user",
                    content: [
                      "Summarize only the successful file write/edit actions listed below.",
                      "Do not claim the full plan is complete unless the listed actions prove it.",
                      execResult.writeFailed > 0 ? `${execResult.writeFailed} write/edit action(s) failed. Mention that the result may be partial if relevant.` : "",
                      missingFiles.length ? `Planned files not found after execution: ${missingFiles.join(", ")}` : "",
                      "",
                      "Successful actions:",
                      actionSummary || "No successful file write/edit actions were recorded.",
                      failedSummary ? "\nFailed actions:\n" + failedSummary : "",
                      "",
                      "Output 2-4 concise bullets. Do NOT output code.",
                    ].filter(Boolean).join("\n"),
                  } as any,
                ],
                tools: {}, maxOutputTokens: 512,
              })
              summary = yield* collectText(summaryStream, "coder")
            } else {
              const reasons = [
                execResult.aborted ? "Coder execution aborted." : "",
                execResult.error ? `Coder execution failed: ${execResult.error}` : "",
                execResult.writeSuccess === 0 ? "No file writes were completed." : "",
                execResult.writeFailed > 0 ? `${execResult.writeFailed} write/edit action(s) failed.` : "",
                execResult.text.trim() ? `Coder final response:\n${execResult.text.trim()}` : "",
              ].filter(Boolean)
              summary = reasons.join("\n")
            }

            coderLastAction = "done"
            coderStartedAt = 0
            coderIsExecuting = false
            currentCoderExecution = null
            setTimeout(() => { coderLastAction = "idle"; coderTokens = 0 }, 8000)

            w("─".repeat(60), "system")
            w("● Coder · " + new Date().toLocaleTimeString(), "coder")
            w(summary, "pm")
            yield* persistChat("assistant", summary, "coder")
            if (missingFiles.length) {
              w(`⚠ Planned files missing after execution: ${missingFiles.join(", ")}`, "warning")
            }
            w("─".repeat(60), "system")
            try {
              const { stdout: statOut } = yield* Effect.promise(() => runGit(["diff", "--stat"], cwd))
              if (statOut.trim()) w(renderDiffStat(statOut), "system")
            } catch {}
            w("")
          })

          // Fork to background — user can continue chatting with PM
          Effect.runFork(coderJob as any)
          coderLastAction = "idle"
          phase = "idle"
          break
        }

        case "intern_task": phase = "idle"; break
        default: phase = "idle"
      }
    }
  })
}

// ── Input ──
function readUserInput(): Effect.Effect<string> {
  return Effect.promise(async () => {
    const text = await Tui.readInput()
    if (text === "/exit" || text === "/quit" || text === "/q") {
      Tui.cleanup()
      process.exit(0)
    }
    return text
  })
}

// ── Git helpers ──
async function runGit(args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd })
    let stdout = ""; let stderr = ""
    child.stdout?.on("data", (d: Buffer) => { stdout += d.toString() })
    child.stderr?.on("data", (d: Buffer) => { stderr += d.toString() })
    child.on("close", () => resolve({ stdout, stderr }))
    child.on("error", (err: Error) => resolve({ stdout, stderr: String(err) }))
  })
}

function renderDiffStat(text: string): string {
  return text.trim().split("\n").map((line) => {
    const parts = line.split("|")
    if (parts.length === 2) {
      const file = parts[0]!.trim()
      const stat = parts[1]!.trim()
      const plus = (stat.match(/\+/g) || []).length
      const minus = (stat.match(/\-/g) || []).length
      const changes: string[] = []
      if (plus > 0) changes.push("Added " + plus + " line" + (plus > 1 ? "s" : ""))
      if (minus > 0) changes.push("removed " + minus + " line" + (minus > 1 ? "s" : ""))
      return "● Update(" + file + ")\n  ⎿  " + changes.join(", ")
    }
    return "  " + line
  }).join("\n")
}

function estimateTokens(msgs: ModelMessage[]): number {
  return msgs.reduce((sum, m) => sum + Math.ceil((m.content as string)?.length / 3.5 || 0), 0)
}

function parsePlan(text: string): PlanArtifact {
  const files: PlanArtifact["files"] = []
  const fileSec = text.match(/## Files\s*\n([\s\S]*?)(?=##|$)/)
  if (fileSec) for (const line of fileSec[1]!.split("\n")) { const m = line.match(/[-*]\s+(?:`)?([^`\s]+)(?:`)?\s+(?:\((\w+)\))?\s*(?:—|–|-)?\s*(.*)/); if (m) files.push({ path: m[1]!, action: (m[2] as any) ?? "modify", description: m[3] ?? "" }) }
  return { summary: text.match(/## Summary\s*\n(.+)/)?.[1]?.trim() ?? "", approach: text.match(/## Approach\s*\n([\s\S]*?)(?=##|$)/)?.[1]?.trim() ?? "", files, risks: [], alternatives: [] }
}

function parseReview(text: string): ReviewArtifact {
  const lower = text.toLowerCase()
  let overall: ReviewArtifact["overall"] = "agree"
  if (lower.includes("disagree") && !lower.includes("agree_with_changes")) overall = "disagree"
  else if (lower.includes("agree_with_changes")) overall = "agree_with_changes"

  const comments: ReviewArtifact["comments"] = []
  const commentRe = /[-*]\s+(.+?):\s+(.+?)(?:\s*[—–-]\s*severity:\s*(blocker|suggestion))?/gi
  let m
  while ((m = commentRe.exec(text)) !== null) {
    comments.push({ topic: m[1]?.trim() ?? "", opinion: m[2]?.trim() ?? "", severity: (m[3] ?? "suggestion") as "blocker" | "suggestion" })
  }

  const changes: ReviewArtifact["suggestedChanges"] = []
  const changeRe = /[-*]\s+(.+?):\s+change\s+(.+?)\s+to\s+(.+?)(?:\s+because\s+(.+))?$/gim
  let c
  while ((c = changeRe.exec(text)) !== null) {
    changes.push({ section: c[1]?.trim() ?? "", change: c[2]?.trim() ?? "", reason: c[4]?.trim() ?? "" })
  }

  return { overall, comments, suggestedChanges: changes }
}

/**
 * BackgroundJob — lightweight async task manager.
 *
 * Replicates OpenCode's background/job.ts pattern:
 *   - Deferred for wait/notify
 *   - Fiber for the running work
 *   - SynchronizedRef for thread-safe state
 *   - Scope for lifecycle management
 */
import { Deferred, Effect, Fiber, Scope, SynchronizedRef } from "effect"

export type JobStatus = "running" | "completed" | "error" | "cancelled"

export interface JobInfo {
  id: string
  type: string
  title?: string
  status: JobStatus
  output?: string
  error?: string
  metadata?: Record<string, unknown>
  startedAt: number
  completedAt?: number
}

interface ActiveJob {
  info: JobInfo
  fiber: Fiber.Fiber<unknown, unknown>
  done: Deferred.Deferred<JobInfo>
}

export class BackgroundJobService {
  private jobs: Map<string, ActiveJob> = new Map()
  private ref = SynchronizedRef.make(this.jobs)

  start(
    id: string,
    type: string,
    title: string | undefined,
    run: Effect.Effect<string, unknown, never>,
    metadata?: Record<string, unknown>,
  ): Effect.Effect<JobInfo, never, Scope.Scope> {
    return Effect.gen(function* () {
      const scope = yield* Scope.Scope
      const done = yield* Deferred.make<JobInfo>()

      const info: JobInfo = {
        id, type, title, status: "running", metadata,
        startedAt: Date.now(),
      }

      const fiber = yield* Effect.forkIn(
        Effect.gen(function* () {
          const result = yield* Effect.exit(run)
          if (result._tag === "Success") {
            info.status = "completed"
            info.output = result.value
          } else {
            info.status = "error"
            info.error = String(result.cause)
          }
          info.completedAt = Date.now()
          yield* Deferred.succeed(done, info)
        }),
        scope,
      )

      const active: ActiveJob = { info, fiber, done }
      const ref = yield* SynchronizedRef.make(new Map<string, ActiveJob>())
      yield* SynchronizedRef.update(ref, (map) => map.set(id, active))

      return info
    })
  }

  async wait(id: string, timeout?: number): Promise<{ info?: JobInfo; timedOut: boolean }> {
    const job = this.jobs.get(id)
    if (!job) return { timedOut: false }
    if (job.info.status !== "running") return { info: job.info, timedOut: false }

    try {
      const effect = Deferred.await(job.done)
      const timed = timeout ? Effect.timeout(effect, timeout) : effect
      const result = await Effect.runPromise(timed)
      return { info: result as JobInfo, timedOut: false }
    } catch {
      return { info: job.info, timedOut: true }
    }
  }

  async cancel(id: string): Promise<JobInfo | undefined> {
    const job = this.jobs.get(id)
    if (!job || job.info.status !== "running") return undefined

    try {
      await Effect.runPromise(Fiber.interrupt(job.fiber))
      job.info.status = "cancelled"
      job.info.completedAt = Date.now()
      return job.info
    } catch {
      return undefined
    }
  }

  list(): JobInfo[] {
    return Array.from(this.jobs.values()).map((j) => ({ ...j.info }))
  }

  get(id: string): JobInfo | undefined {
    const job = this.jobs.get(id)
    return job ? { ...job.info } : undefined
  }
}

// Singleton
export const backgroundJobs = new BackgroundJobService()

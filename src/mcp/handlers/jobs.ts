/**
 * P2 — in-memory registry for background jobs.
 *
 * Genuinely long work (batch extraction over dozens of URLs, long see_page
 * step sequences, long-running page JS) cannot finish inside the MCP
 * client's ~60s request timeout. Instead of letting those calls die at the
 * watchdog — the failure mode behind the Claude tool_use/tool_result
 * pairing error — the caller opts in with `async: true`, gets a jobId back
 * immediately, and polls the `async_job` tool for the result.
 *
 * This module is ONLY the registry (records + lifecycle). Execution wiring
 * lives in handlers/index.ts, which runs the work through the existing
 * serialize() chain and races it against the job timeout — keeping the
 * import graph acyclic (index.ts imports jobs.ts, never the reverse).
 */

export type JobStatus = 'running' | 'completed' | 'error';

export interface JobRecord {
  id: string;
  label: string;
  status: JobStatus;
  startedAt: number;
  finishedAt?: number;
  result?: unknown;
  error?: string;
  cancelled: boolean;
  /** Epoch-ms deadline set by the runner while the job executes (P1b). */
  deadline?: number;
}

const MAX_FINISHED_JOBS = 20;

const jobs = new Map<string, JobRecord>();
let jobSeq = 0;

/** Hard cap for a single job; overridable via REAL_BROWSER_JOB_TIMEOUT_MS. */
export function jobTimeoutMs(): number {
  const fromEnv = Number(process.env.REAL_BROWSER_JOB_TIMEOUT_MS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 600000;
}

export function createJob(label: string): JobRecord {
  jobSeq += 1;
  const job: JobRecord = {
    id: `job-${Date.now().toString(36)}-${jobSeq}`,
    label,
    status: 'running',
    startedAt: Date.now(),
    cancelled: false,
  };
  jobs.set(job.id, job);
  return job;
}

export function getJob(id: string): JobRecord | undefined {
  return jobs.get(id);
}

/** Metadata-only view used by async_job status/list (never leaks payloads). */
export function jobMeta(job: JobRecord): Record<string, unknown> {
  const meta: Record<string, unknown> = {
    jobId: job.id,
    label: job.label,
    status: job.status,
    startedAt: new Date(job.startedAt).toISOString(),
    elapsedMs: (job.finishedAt ?? Date.now()) - job.startedAt,
  };
  if (job.finishedAt) meta.finishedAt = new Date(job.finishedAt).toISOString();
  if (job.status === 'error' && job.error) meta.error = job.error;
  return meta;
}

export function listJobs(): JobRecord[] {
  return [...jobs.values()].sort((a, b) => b.startedAt - a.startedAt);
}

/** Flag a running job for cancellation; its loops stop at their next check. */
export function requestJobCancel(job: JobRecord): void {
  job.cancelled = true;
}

export function finishJob(job: JobRecord, status: Exclude<JobStatus, 'running'>, payload: { result?: unknown; error?: string }): void {
  if (job.status !== 'running') return; // first finish wins (timeout/cancel races)
  job.status = status;
  job.finishedAt = Date.now();
  if (payload.result !== undefined) job.result = payload.result;
  if (payload.error !== undefined) job.error = payload.error;
  evictOldFinishedJobs();
}

function evictOldFinishedJobs(): void {
  const finished = [...jobs.values()]
    .filter(j => j.status !== 'running')
    .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0));
  while (finished.length > MAX_FINISHED_JOBS) {
    const oldest = finished.shift()!;
    jobs.delete(oldest.id);
  }
}

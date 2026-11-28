const pausedProjects = new Set<string>();
const deletedProjects = new Set<string>();
const writeJobs = new Map<string, Set<{ controller: AbortController; done: Promise<unknown> }>>();

export function isClipperProjectDeleted(projectId: string): boolean {
  return deletedProjects.has(projectId);
}

export function assertClipperProjectWritable(projectId: string): void {
  if (pausedProjects.has(projectId) || deletedProjects.has(projectId)) {
    throw new DOMException("Project is unavailable for writing.", "AbortError");
  }
}

/** Project maintenance can stop and await writers before removing their files. */
export async function withClipperProjectWrite<T>(
  projectId: string,
  signal: AbortSignal | undefined,
  write: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  assertClipperProjectWritable(projectId);
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const jobs = writeJobs.get(projectId) ?? new Set();
  writeJobs.set(projectId, jobs);
  const job = { controller, done: Promise.resolve().then(() => {
    controller.signal.throwIfAborted();
    return write(controller.signal);
  }) };
  jobs.add(job);
  try {
    return await job.done;
  } finally {
    signal?.removeEventListener("abort", abort);
    jobs.delete(job);
    if (!jobs.size) writeJobs.delete(projectId);
  }
}

export async function pauseClipperProjectWrites(projectId: string): Promise<void> {
  assertClipperProjectWritable(projectId);
  pausedProjects.add(projectId);
  const jobs = [...(writeJobs.get(projectId) ?? [])];
  for (const job of jobs) job.controller.abort();
  await Promise.allSettled(jobs.map((job) => job.done));
}

export function resumeClipperProjectWrites(projectId: string): void {
  pausedProjects.delete(projectId);
}

export function markClipperProjectDeleted(projectId: string): void {
  deletedProjects.add(projectId);
  pausedProjects.delete(projectId);
}

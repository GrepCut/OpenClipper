const deletingProjects = new Set<string>();
const deletedProjects = new Set<string>();
const renderJobs = new Map<string, Set<{ controller: AbortController; done: Promise<unknown> }>>();

export function isClipperProjectDeleted(projectId: string): boolean {
  return deletedProjects.has(projectId);
}

export function assertClipperProjectWritable(projectId: string): void {
  if (deletingProjects.has(projectId) || deletedProjects.has(projectId)) {
    throw new DOMException("Project is being deleted.", "AbortError");
  }
}

/** Deletion can stop and await render writers before removing their files. */
export async function withClipperProjectRender<T>(
  projectId: string,
  signal: AbortSignal,
  render: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  assertClipperProjectWritable(projectId);
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  const jobs = renderJobs.get(projectId) ?? new Set();
  renderJobs.set(projectId, jobs);
  const job = { controller, done: Promise.resolve().then(() => {
    controller.signal.throwIfAborted();
    return render(controller.signal);
  }) };
  jobs.add(job);
  try {
    return await job.done;
  } finally {
    signal.removeEventListener("abort", abort);
    jobs.delete(job);
    if (!jobs.size) renderJobs.delete(projectId);
  }
}

export async function pauseClipperProjectRenders(projectId: string): Promise<void> {
  deletingProjects.add(projectId);
  const jobs = [...(renderJobs.get(projectId) ?? [])];
  for (const job of jobs) job.controller.abort();
  await Promise.allSettled(jobs.map((job) => job.done));
}

export function resumeClipperProjectRenders(projectId: string): void {
  deletingProjects.delete(projectId);
}

export function markClipperProjectDeleted(projectId: string): void {
  deletedProjects.add(projectId);
  deletingProjects.delete(projectId);
}

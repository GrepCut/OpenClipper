/** Yields to the browser so the UI thread can paint and handle input. */
export function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler;
    if (scheduler?.yield) {
      void scheduler.yield().then(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });
}

/** A thank-you to show once on the next screen (e.g. the queue after a letter was sent). Kept in memory only. */
let pending: { label: string } | null = null;

export function celebrate(c: { label: string }): void {
  pending = c;
}

/** Read and clear: the thank-you shows once. */
export function takeCelebration(): { label: string } | null {
  const c = pending;
  pending = null;
  return c;
}

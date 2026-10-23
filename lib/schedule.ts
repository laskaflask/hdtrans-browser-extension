// Picking which pending work goes to the engine next.

export interface BatchLimits {
  lines: number;
  chars: number;
}

export interface Sized {
  lines: number;
  chars: number;
}

/** The next batch out of pending, and what is left in its order. Urgent items (on screen)
 *  go first and alone, so a scrolled-to part is not held up by the rest of the page;
 *  without any, the batch is the first items in order. */
export function takeBatch<T>(
  pending: readonly T[],
  size: (item: T) => Sized,
  urgent: (item: T) => boolean,
  limits: BatchLimits,
): { batch: T[]; rest: T[] } {
  const anyUrgent = pending.some(urgent);
  const batch: T[] = [];
  const taken = new Set<T>();
  let lines = 0;
  let chars = 0;
  for (const item of pending) {
    if (anyUrgent && !urgent(item)) continue;
    const s = size(item);
    if (batch.length && (lines + s.lines > limits.lines || chars > limits.chars)) break;
    batch.push(item);
    taken.add(item);
    lines += s.lines;
    chars += s.chars;
  }
  return { batch, rest: pending.filter((item) => !taken.has(item)) };
}

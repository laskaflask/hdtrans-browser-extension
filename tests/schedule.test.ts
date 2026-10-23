import { describe, expect, it } from 'vitest';
import { takeBatch } from '../lib/schedule';

const size = (n: number) => ({ lines: 1, chars: n });
const limits = { lines: 3, chars: 100 };

describe('takeBatch', () => {
  it('takes the first items in order when nothing is urgent', () => {
    const { batch, rest } = takeBatch([1, 2, 3, 4, 5], size, () => false, limits);
    expect(batch).toEqual([1, 2, 3]);
    expect(rest).toEqual([4, 5]);
  });

  it('takes only urgent items while there are any, keeping the rest in order', () => {
    const urgent = (n: number) => n === 2 || n === 5;
    const { batch, rest } = takeBatch([1, 2, 3, 4, 5], size, urgent, limits);
    expect(batch).toEqual([2, 5]);
    expect(rest).toEqual([1, 3, 4]);
  });

  it('closes the batch once the characters run over, but never leaves it empty', () => {
    expect(takeBatch([60, 50, 10], size, () => false, limits).batch).toEqual([60, 50]);
    expect(takeBatch([500, 1], size, () => false, limits).batch).toEqual([500]);
  });

  it('returns an empty batch for no pending work', () => {
    expect(takeBatch([], size, () => true, limits)).toEqual({ batch: [], rest: [] });
  });
});

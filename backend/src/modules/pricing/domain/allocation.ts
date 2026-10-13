/**
 * Splits an integer amount across weights proportionally using the largest-remainder method,
 * so the parts are integers that always sum exactly to `total` and never exceed their weight
 * when `total <= sum(weights)`.
 */
export function allocate(total: number, weights: readonly number[]): number[] {
  if (!Number.isInteger(total) || total < 0) throw new RangeError(`Cannot allocate ${total}`);
  const sum = weights.reduce((s, w) => s + w, 0);
  if (total === 0) return weights.map(() => 0);
  if (sum <= 0) throw new RangeError('Cannot allocate across zero weights');

  const exact = total * sum <= Number.MAX_SAFE_INTEGER;
  const split = (w: number): [share: number, frac: number] => {
    if (exact) return [Math.floor((total * w) / sum), (total * w) % sum];
    const product = BigInt(total) * BigInt(w);
    return [Number(product / BigInt(sum)), Number(product % BigInt(sum))];
  };

  const parts = weights.map(split);
  const shares = parts.map(([share]) => share);
  let remainder = total - shares.reduce((s, v) => s + v, 0);
  const order = weights
    .map((w, i) => ({ i, w, frac: parts[i][1] }))
    .filter(x => x.w > 0)
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let j = 0; remainder > 0; j = (j + 1) % order.length, remainder--) shares[order[j].i] += 1;
  return shares;
}

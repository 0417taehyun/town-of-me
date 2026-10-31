// Order statistics for the swing calibration. Sorting and arithmetic only, so every engine gets the same value.

/** The value `fraction` (0..1) of the way through the non-empty `values` in sorted order, between neighbors. */
export function percentile(values: readonly number[], fraction: number) {
  const sorted = [...values].sort((first, second) => first - second)
  const rank = (sorted.length - 1) * fraction
  const lower = Math.floor(rank)
  const upper = Math.min(sorted.length - 1, lower + 1)
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (rank - lower)
}

export function median(values: readonly number[]) {
  return percentile(values, 0.5)
}

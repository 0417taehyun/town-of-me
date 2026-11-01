// Keyframe tracks for the ballplayers' motions (the batter's swing, the pitcher's throw): each channel is keyed at the
// motion's key times and played back as a Fritsch-Carlson monotone cubic.

/** Fritsch-Carlson monotone cubic: smooth through its keys, it never overshoots them and holds flat stretches still. */
export type MonotoneTrack = { times: number[]; values: number[]; tangents: number[] }

export function monotoneTrack(times: number[], values: number[]): MonotoneTrack {
  const slopes = times.slice(1).map((time, index) => (values[index + 1] - values[index]) / (time - times[index]))
  const tangents = times.map((_, index) => keyTangent(slopes[index - 1], slopes[index]))
  slopes.forEach((slope, index) => limitTangents(tangents, slope, index))
  return { times, values, tangents }
}

/** The tangent at a key between spans of these slopes: flat at the ends and at a turn, else their mean. */
export function keyTangent(before: number | undefined, after: number | undefined) {
  if (before === undefined || after === undefined || before * after <= 0) return 0
  return (before + after) / 2
}

/** Scales back the tangents at both ends of span `index` so the curve cannot overshoot its keys. */
export function limitTangents(tangents: number[], slope: number, index: number) {
  // A flat span's ends are already flat (keyTangent), so it holds still.
  if (slope === 0) return
  const before = tangents[index] / slope
  const after = tangents[index + 1] / slope
  const size = before * before + after * after
  if (size <= 9) return
  const scale = 3 / Math.sqrt(size)
  tangents[index] = scale * before * slope
  tangents[index + 1] = scale * after * slope
}

export function sampleTrack({ times, values, tangents }: MonotoneTrack, time: number) {
  const last = times.length - 1
  if (time <= times[0]) return values[0]
  if (time >= times[last]) return values[last]
  const index = times.findIndex((at) => at > time) - 1
  const span = times[index + 1] - times[index]
  const amount = (time - times[index]) / span
  const squared = amount * amount
  const cubed = squared * amount
  return (
    (2 * cubed - 3 * squared + 1) * values[index] +
    (cubed - 2 * squared + amount) * span * tangents[index] +
    (-2 * cubed + 3 * squared) * values[index + 1] +
    (cubed - squared) * span * tangents[index + 1]
  )
}

/** How fast (value per unit of time) a track moves at `time`; still before its first key and after its last. */
export function sampleTrackRate({ times, values, tangents }: MonotoneTrack, time: number) {
  const last = times.length - 1
  if (time <= times[0] || time >= times[last]) return 0
  const index = times.findIndex((at) => at > time) - 1
  const span = times[index + 1] - times[index]
  const amount = (time - times[index]) / span
  const squared = amount * amount
  return (
    ((6 * squared - 6 * amount) * (values[index] - values[index + 1])) / span +
    (3 * squared - 4 * amount + 1) * tangents[index] +
    (3 * squared - 2 * amount) * tangents[index + 1]
  )
}

/** A track per channel of `keys`, each keyed at `times`. */
export function keyedTracks<Channel extends string>(times: number[], keys: Record<Channel, number[]>) {
  return Object.fromEntries(
    Object.entries<number[]>(keys).map(([channel, values]) => [channel, monotoneTrack(times, values)]),
  ) as Record<Channel, MonotoneTrack>
}

/** Every track sampled at `time`. */
export function sampleTracks<Channel extends string>(tracks: Record<Channel, MonotoneTrack>, time: number) {
  return Object.fromEntries(
    Object.entries<MonotoneTrack>(tracks).map(([channel, track]) => [channel, sampleTrack(track, time)]),
  ) as Record<Channel, number>
}

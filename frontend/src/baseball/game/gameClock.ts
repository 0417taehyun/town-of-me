// Game time, in ms, read off the real clock (performance.now() and input timestamps). Slow motion and pausing change
// how fast it runs but never make it jump, so a pitch's timeline stays continuous through every change; only a hit-stop
// may step it back, to hold the contact a swing reported late already made. The clock keeps no history: a real moment
// before its latest change reads as the moment of that change, so convert an input's timestamp to game time before
// changing the clock when the input matters.

/** From real moment `realMs` on, game time runs on from `gameMs` at `rate` times real time; before it, it holds. */
export type GameClock = { realMs: number; gameMs: number; rate: number }

export function createGameClock(realMs: number): GameClock {
  return { realMs, gameMs: 0, rate: 1 }
}

export function gameTime(clock: GameClock, realMs: number) {
  return clock.gameMs + Math.max(0, realMs - clock.realMs) * clock.rate
}

/**
 * From `realMs` on, game time runs at `rate`: 1 normally, under 1 in slow motion, 0 while paused. During a hit-stop the
 * new rate starts when the hold ends, so slow motion begun at the same contact keeps the whole freeze.
 */
export function setClockRate(clock: GameClock, realMs: number, rate: number): GameClock {
  const fromMs = Math.max(realMs, clock.realMs)
  return { realMs: fromMs, gameMs: gameTime(clock, fromMs), rate }
}

/**
 * Hit-stop: game time stands still at `atGameMs` for `durationMs` of real time from `realMs`, then runs on from there at
 * the rate it had. It holds the moment `realMs` reads unless `atGameMs` is earlier, never a moment still to come.
 */
export function holdClock(clock: GameClock, realMs: number, durationMs: number, atGameMs = Infinity): GameClock {
  return { realMs: realMs + durationMs, gameMs: Math.min(atGameMs, gameTime(clock, realMs)), rate: clock.rate }
}

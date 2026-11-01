// A run's random numbers: mulberry32, which steps a 32-bit integer with Math.imul, shifts, and xor only, so every
// JavaScript engine draws the same sequence from the same seed. The pitch plan draws from it, and so do the looks of
// the people around the play (stadium/guestLooks.ts); how a swing lands is never random. motionMath.seededFraction
// stays decoration because it is built on Math.sin.

/** Uniform draws in [0, 1) from a 32-bit unsigned `seed`. */
export function createSeededRandom(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = Math.imul(state ^ (state >>> 15), state | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

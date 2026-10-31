/** `density` is the share of samples that are not silent: sparse crackle reads as snow crunch, dense as a scuff. */
export function noiseSample(density: number) {
  return Math.random() < density ? Math.random() * 2 - 1 : 0
}

export function createNoiseBuffer(context: AudioContext, seconds: number, density = 1) {
  const buffer = context.createBuffer(1, Math.floor(context.sampleRate * seconds), context.sampleRate)
  const samples = buffer.getChannelData(0)
  for (let index = 0; index < samples.length; index += 1) samples[index] = noiseSample(density)
  return buffer
}

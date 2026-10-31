import { clamp } from '../motionMath'

export function createPantSamples(sampleRate: number) {
  const samples = new Float32Array(Math.floor(sampleRate * 0.18))
  for (let index = 0; index < samples.length; index += 1) {
    const envelope = Math.sin((Math.PI * index) / (samples.length - 1)) ** 2
    samples[index] = (Math.random() - 0.5) * 0.3 * envelope
  }
  return samples
}

export function createPant(context: AudioContext) {
  const samples = createPantSamples(context.sampleRate)
  const buffer = context.createBuffer(1, samples.length, context.sampleRate)
  buffer.copyToChannel(samples, 0)
  const filter = context.createBiquadFilter()
  filter.type = 'bandpass'
  filter.frequency.value = 1050
  filter.Q.value = 0.65
  const gain = context.createGain()
  gain.gain.value = 0.025
  filter.connect(gain).connect(context.destination)
  const sources = new Set<AudioBufferSourceNode>()
  let busy = false
  let disposed = false
  let generation = 0
  let volumeScale = 1

  function puff(offset: number, index: number) {
    const source = context.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = 1 + (index % 2) * 0.08
    source.connect(filter)
    sources.add(source)
    source.onended = () => {
      source.disconnect()
      sources.delete(source)
      busy = sources.size > 0
    }
    source.start(context.currentTime + offset)
  }

  function puffIfCurrent(request: number) {
    if (disposed || request !== generation) return false
    if (context.state !== 'running') {
      busy = false
      return false
    }
    ;[0, 0.23, 0.5, 0.73].forEach(puff)
    return true
  }

  function releaseIfCurrent(request: number) {
    if (request === generation) busy = false
    return false
  }

  function stop() {
    generation += 1
    sources.forEach((source) => {
      source.onended = null
      source.stop()
      source.disconnect()
    })
    sources.clear()
    busy = false
  }

  return {
    async play() {
      if (disposed) return false
      if (busy) return true
      busy = true
      const request = ++generation
      try {
        await context.resume()
        return puffIfCurrent(request)
      } catch {
        return releaseIfCurrent(request)
      }
    },
    setVolume(nextVolume: number) {
      volumeScale = clamp(nextVolume, 0, 8)
      gain.gain.value = 0.025 * volumeScale
    },
    stop,
    dispose() {
      disposed = true
      stop()
      filter.disconnect()
      gain.disconnect()
    },
  }
}

import { describe, expect, it, vi } from 'vitest'
import { createFrameTimestamps, createOnGpuOrCpu, createVisionTask, type VideoTask } from './tasksVision'

const frame = {} as TexImageSource

function fakeTask(name: string) {
  return { detectForVideo: vi.fn(() => name), close: vi.fn() } satisfies VideoTask<string>
}

describe('MediaPipe tasks', () => {
  it('builds on the CPU when the GPU delegate fails, and only then', async () => {
    const create = vi.fn(async (delegate: string) => {
      if (delegate === 'GPU') throw new Error('kGpuService unavailable')
      return 'cpu task'
    })
    await expect(createOnGpuOrCpu(create)).resolves.toEqual({ task: 'cpu task', delegate: 'CPU' })
    expect(create.mock.calls).toEqual([['GPU'], ['CPU']])

    const gpuOnly = vi.fn(async (delegate: string) => `${delegate} task`)
    await expect(createOnGpuOrCpu(gpuOnly)).resolves.toEqual({ task: 'GPU task', delegate: 'GPU' })
    expect(gpuOnly).toHaveBeenCalledTimes(1)
  })

  it('stamps frames in strictly increasing order even when frame times repeat or go back', () => {
    const timestamp = createFrameTimestamps()
    const stamps = [1000, 1033.4, 1033.4, 1020, 1066.7, 1067].map(timestamp)
    expect(stamps.slice(1).every((stamp, index) => stamp > stamps[index])).toBe(true)
    expect(stamps[0]).toBe(1000)
    expect(stamps[4]).toBeCloseTo(1066.7, 9)
  })

  it('stops detecting when the WebGL context is lost and builds a new task once it is restored', async () => {
    const canvas = new EventTarget() as HTMLCanvasElement
    const tasks = [fakeTask('first'), fakeTask('rebuilt')]
    const build = vi.fn(async () => tasks[build.mock.calls.length - 1])
    const pose = await createVisionTask(build, canvas)
    expect(pose.detect(frame, 0)).toBe('first')

    const lost = new Event('webglcontextlost', { cancelable: true })
    canvas.dispatchEvent(lost)
    expect(lost.defaultPrevented).toBe(true)
    expect(tasks[0].close).toHaveBeenCalled()
    expect(pose.detect(frame, 33)).toBeNull()
    expect(tasks[0].detectForVideo).toHaveBeenCalledTimes(1)

    canvas.dispatchEvent(new Event('webglcontextrestored'))
    await vi.waitFor(() => expect(pose.detect(frame, 66)).toBe('rebuilt'))
    expect(build).toHaveBeenLastCalledWith('GPU', canvas)
  })

  it('frees a task rebuilt after it was closed or lost again, so no WebGL context is left behind', async () => {
    const rebuildEndingIn = async (interrupt: (canvas: HTMLCanvasElement, pose: { close: () => void }) => void) => {
      const canvas = new EventTarget() as HTMLCanvasElement
      const rebuilt = fakeTask('rebuilt')
      let finishRebuild = () => {}
      const build = vi
        .fn<() => Promise<VideoTask<string>>>()
        .mockResolvedValueOnce(fakeTask('first'))
        .mockReturnValueOnce(new Promise((resolve) => (finishRebuild = () => resolve(rebuilt))))
      const pose = await createVisionTask(build, canvas)
      canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }))
      canvas.dispatchEvent(new Event('webglcontextrestored'))
      interrupt(canvas, pose)
      finishRebuild()
      await vi.waitFor(() => expect(rebuilt.close).toHaveBeenCalled())
      expect(pose.detect(frame, 99)).toBeNull()
      expect(rebuilt.detectForVideo).not.toHaveBeenCalled()
    }
    await rebuildEndingIn((_, pose) => pose.close())
    await rebuildEndingIn((canvas) => canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true })))
  })
})

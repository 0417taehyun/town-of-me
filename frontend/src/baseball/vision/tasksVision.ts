import type { ObjectDetectorResult, PoseLandmarkerResult } from '@mediapipe/tasks-vision'
import simdLoaderUrl from '@mediapipe/tasks-vision/vision_wasm_internal.js?url'
import simdBinaryUrl from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url'
import plainLoaderUrl from '@mediapipe/tasks-vision/vision_wasm_nosimd_internal.js?url'
import plainBinaryUrl from '@mediapipe/tasks-vision/vision_wasm_nosimd_internal.wasm?url'
import { HELD_OBJECT_LABELS, HELD_OBJECT_RULES } from './heldObject'

// MediaPipe Tasks Vision, loaded only once the visitor turns the camera on, with everything served from this origin:
// the wasm through Vite, the models from public/assets/models. Imports from frontend/ resolve to frontend's own copy of
// the package, wherever npm puts the 0.10.17 that @react-three/drei depends on.
//
// The package is pinned to exactly 0.10.35 (frontend/package.json; .github/dependabot.yml ignores >=1.0.0). From
// 1.0.0 on it sends usage logs to Google (POST odml.pa.googleapis.com/v1/log) with no way to turn them off, and the
// webcam must never send anything off the device. /baseball's CSP (`connect-src 'self'`, docker/nginx.conf) would
// block such a request anyway; the pin keeps any upgrade a deliberate change that is checked for outgoing requests
// first. 0.10.x leaves three things to its caller, handled here: a GPU delegate that fails to start, a lost WebGL
// context, and frame timestamps that must strictly increase (one that does not breaks the task for good).

export const POSE_MODEL_PATH = '/assets/models/pose_landmarker_lite.task'
export const OBJECT_MODEL_PATH = '/assets/models/efficientdet_lite0.tflite'

export type VisionDelegate = 'GPU' | 'CPU'

/** What this module needs from a MediaPipe task running in video mode. */
export type VideoTask<Result> = {
  detectForVideo: (frame: TexImageSource, timestamp: number) => Result
  close: () => void
}

/**
 * Builds a task on `delegate`. The task draws on `canvas`, so this module hears when that WebGL context is lost; the
 * CPU delegate needs it too, for the frames it converts.
 */
export type VideoTaskBuilder<Result> = (
  delegate: VisionDelegate,
  canvas: HTMLCanvasElement,
) => Promise<VideoTask<Result>>

export type VisionTask<Result> = {
  /** The frame's result, or null while the task is rebuilt after its WebGL context was lost. */
  detect: (frame: TexImageSource, frameTime: number) => Result | null
  close: () => void
}

/** Builds a task on the GPU, or on the CPU when the GPU delegate throws: 0.10.x does not fall back by itself. */
export async function createOnGpuOrCpu<Task>(
  create: (delegate: VisionDelegate) => Promise<Task>,
): Promise<{ task: Task; delegate: VisionDelegate }> {
  try {
    return { task: await create('GPU'), delegate: 'GPU' }
  } catch {
    return { task: await create('CPU'), delegate: 'CPU' }
  }
}

/**
 * Timestamps for one task from frame times (ms) that may repeat or go back, as when the clock source changes: each is
 * the frame time or 1 ms after the previous one, whichever is later.
 */
export function createFrameTimestamps() {
  let previous = -Infinity
  return (frameTime: number) => {
    previous = Math.max(frameTime, previous + 1)
    return previous
  }
}

/**
 * A task built by `build` on the GPU or the CPU that survives a lost WebGL context: from `webglcontextlost` it returns
 * no results, and once the browser restores the context it builds the task again (0.10.x neither notices the loss nor
 * recovers). A rebuild that fails, or that a newer loss overtakes, leaves the task without results.
 */
export async function createVisionTask<Result>(
  build: VideoTaskBuilder<Result>,
  canvas: HTMLCanvasElement = document.createElement('canvas'),
): Promise<VisionTask<Result>> {
  const buildOnCanvas = async () => (await createOnGpuOrCpu((delegate) => build(delegate, canvas))).task
  let task: VideoTask<Result> | null = await buildOnCanvas()
  let losses = 0
  let closed = false
  const timestamp = createFrameTimestamps()

  const release = () => {
    try {
      task?.close()
    } catch {
      // A task whose context is gone may fail to free what it held; there is nothing left to free.
    }
    task = null
  }
  const onLost = (event: Event) => {
    // Without this the browser never restores the context.
    event.preventDefault()
    losses += 1
    release()
  }
  const onRestored = async () => {
    const lossesBefore = losses
    const rebuilt = await buildOnCanvas().catch(() => null)
    if (closed || losses !== lossesBefore) return rebuilt?.close()
    task = rebuilt
  }
  canvas.addEventListener('webglcontextlost', onLost)
  canvas.addEventListener('webglcontextrestored', onRestored)

  return {
    detect: (frame, frameTime) => task?.detectForVideo(frame, timestamp(frameTime)) ?? null,
    close: () => {
      closed = true
      canvas.removeEventListener('webglcontextlost', onLost)
      canvas.removeEventListener('webglcontextrestored', onRestored)
      release()
    },
  }
}

let tasksVision: ReturnType<typeof importTasksVision> | null = null

/** The library and the wasm this browser runs (SIMD unless it lacks it), loaded once; a failed load is tried again. */
export function loadTasksVision() {
  tasksVision ??= importTasksVision().catch((error: unknown) => {
    tasksVision = null
    throw error
  })
  return tasksVision
}

export async function importTasksVision() {
  const vision = await import('@mediapipe/tasks-vision')
  const simd = await vision.FilesetResolver.isSimdSupported()
  const fileset = simd
    ? { wasmLoaderPath: simdLoaderUrl, wasmBinaryPath: simdBinaryUrl }
    : { wasmLoaderPath: plainLoaderUrl, wasmBinaryPath: plainBinaryUrl }
  return { vision, fileset }
}

/** Builds MediaPipe Pose Lite in video mode, tracking one person. */
export async function buildPoseLandmarker(
  delegate: VisionDelegate,
  canvas: HTMLCanvasElement,
): Promise<VideoTask<PoseLandmarkerResult>> {
  const { vision, fileset } = await loadTasksVision()
  return vision.PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: POSE_MODEL_PATH, delegate },
    canvas,
    runningMode: 'VIDEO',
    numPoses: 1,
  })
}

/** The visitor's pose tracker: Pose Lite on the GPU or the CPU, rebuilt after a lost WebGL context. */
export function createPoseTracker() {
  return createVisionTask(buildPoseLandmarker)
}

/**
 * How sure a detection a dev build's object detector reports must be: below the held object's bar, so the diagnostics'
 * panel and saved log also show what a lower `candidateScore` would take. Play is the same, since the likeliest
 * detections come first and only those sure enough count (heldObject.ts lockCandidates).
 */
export const DEV_DETECTOR_SCORE = 0.2

/**
 * Builds EfficientDet-Lite0 in video mode, finding only the objects a visitor might hold, sure enough to be one
 * (heldObject.ts; a dev build's go lower), the few likeliest of each frame.
 */
export async function buildObjectDetector(
  delegate: VisionDelegate,
  canvas: HTMLCanvasElement,
): Promise<VideoTask<ObjectDetectorResult>> {
  const { vision, fileset } = await loadTasksVision()
  return vision.ObjectDetector.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: OBJECT_MODEL_PATH, delegate },
    canvas,
    runningMode: 'VIDEO',
    scoreThreshold: import.meta.env.DEV ? DEV_DETECTOR_SCORE : HELD_OBJECT_RULES.candidateScore,
    maxResults: 6,
    categoryAllowlist: [...HELD_OBJECT_LABELS],
  })
}

/** The held-object detector, on its own canvas: on the GPU or the CPU, rebuilt after a lost WebGL context. */
export function createObjectDetector() {
  return createVisionTask(buildObjectDetector)
}

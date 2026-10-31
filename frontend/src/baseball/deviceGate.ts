import { supportsWebGL } from '../scene/webglSupport'

// What stops a visitor, checked in order. Before anything loads, the devices the derby cannot be played on at all: a
// phone or tablet first, as its screen cannot be read from where a batter stands; then a browser without WebGL 2,
// which cannot draw the stadium (nor run the pose task, which needs WebGL even on the CPU). Once the visitor turns the
// camera on, the camera itself, whose problems the page names with another try, and then how fast this computer
// tracks a pose (vision/performanceTier.ts): one too slow is blocked like the others, with no retry, since measuring
// again could let it in on a lucky run.

/** A device the derby cannot be played on: a phone or tablet, no WebGL 2, or a computer that tracks too slowly. */
export type DeviceBlock = 'mobile' | 'graphics' | 'slow'

/**
 * Why the camera game cannot start: the camera was refused, is missing, is busy in another app, or failed otherwise;
 * or the camera works and the pose task could not start on it. Each leaves another try.
 */
export type CameraGameProblem = 'denied' | 'missing' | 'busy' | 'failed' | 'tracking'

/** The `getUserMedia` errors with a cause the visitor can act on; anything else is `failed`. */
export const CAMERA_ERRORS: ReadonlyMap<string, CameraGameProblem> = new Map([
  ['NotAllowedError', 'denied'],
  ['SecurityError', 'denied'],
  ['NotFoundError', 'missing'],
  ['OverconstrainedError', 'missing'],
  ['NotReadableError', 'busy'],
])

/**
 * What the gate reads from the browser. `mobileHint` is `navigator.userAgentData.mobile`, which only Chromium reports;
 * `touchOnly` is a coarse primary pointer with no fine one anywhere, as on an Android tablet whose user agent looks
 * like a desktop's.
 */
export type DeviceTraits = {
  userAgent: string
  platform: string
  maxTouchPoints: number
  mobileHint: boolean | undefined
  touchOnly: boolean
}

/** A phone or tablet. iPadOS reports a Mac's user agent and platform but has touch points, which a Mac never has. */
export function isMobileDevice(device: DeviceTraits) {
  const iPadAsMac = device.platform === 'MacIntel' && device.maxTouchPoints > 1
  return device.mobileHint === true || /Mobi/iu.test(device.userAgent) || iPadAsMac || device.touchOnly
}

/**
 * Why this device cannot play before anything loads, or null when it can; `hasWebGL2` is asked only when the device is
 * not mobile.
 */
export function deviceBlock(device: DeviceTraits, hasWebGL2: () => boolean): DeviceBlock | null {
  if (isMobileDevice(device)) return 'mobile'
  if (!hasWebGL2()) return 'graphics'
  return null
}

export function browserDeviceTraits(): DeviceTraits {
  const hints = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
    mobileHint: hints?.mobile,
    touchOnly: window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches,
  }
}

/** This browser's block, probing WebGL 2 with a throwaway canvas the same way the stage's canvas does. */
export function browserDeviceBlock() {
  return deviceBlock(browserDeviceTraits(), () =>
    supportsWebGL(() => document.createElement('canvas').getContext('webgl2')),
  )
}

/** Why the camera did not start, from the error that vision/cameraInput.ts's `startCamera` rejected with. */
export function cameraProblem(error: unknown): CameraGameProblem {
  return CAMERA_ERRORS.get(error instanceof Error ? error.name : '') ?? 'failed'
}

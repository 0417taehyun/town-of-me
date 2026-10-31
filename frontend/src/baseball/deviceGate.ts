import { supportsWebGL } from '../scene/webglSupport'

// The devices the derby cannot be played on, checked in order before anything loads. A phone or tablet is blocked
// first: its screen cannot be read from where a batter stands, and a touch screen has no key to swing with. Then a
// browser without WebGL 2, which cannot draw the stadium at all. The camera and performance checks join later.

export type DeviceBlock = 'mobile' | 'graphics'

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

/** Why this device cannot play, or null when it can; `hasWebGL2` is asked only when the device is not mobile. */
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

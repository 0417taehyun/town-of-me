import { describe, expect, it, vi } from 'vitest'
import { cameraProblem, deviceBlock, type DeviceTraits } from './deviceGate'

const macDesktop: DeviceTraits = {
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Safari/605.1.15',
  platform: 'MacIntel',
  maxTouchPoints: 0,
  mobileHint: undefined,
  touchOnly: false,
}

describe('the derby device gate', () => {
  it('blocks phones and tablets, an iPad posing as a Mac included, before it probes the graphics', () => {
    const handhelds: DeviceTraits[] = [
      {
        ...macDesktop,
        userAgent:
          'Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/19.0 Mobile/15E148 Safari/604.1',
        platform: 'iPhone',
        maxTouchPoints: 5,
      },
      { ...macDesktop, maxTouchPoints: 5 },
      {
        userAgent: 'Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
        platform: 'Linux armv8l',
        maxTouchPoints: 10,
        mobileHint: false,
        touchOnly: true,
      },
      { ...macDesktop, platform: 'Linux armv8l', mobileHint: true },
    ]
    const hasWebGL2 = vi.fn(() => true)
    expect(handhelds.map((device) => deviceBlock(device, hasWebGL2))).toEqual(handhelds.map(() => 'mobile'))
    expect(hasWebGL2).not.toHaveBeenCalled()
  })

  it('blocks a computer only when it has no WebGL 2, touch screen or not', () => {
    const touchLaptop: DeviceTraits = {
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
      platform: 'Win32',
      maxTouchPoints: 10,
      mobileHint: false,
      touchOnly: false,
    }
    expect([macDesktop, touchLaptop].map((device) => deviceBlock(device, () => true))).toEqual([null, null])
    expect(deviceBlock(macDesktop, () => false)).toBe('graphics')
  })

  it('names why the camera did not start, so the visitor can fix it and try again', () => {
    const errors = ['NotAllowedError', 'NotFoundError', 'NotReadableError', 'AbortError'].map(
      (name) => new DOMException('', name),
    )
    expect(errors.map(cameraProblem)).toEqual(['denied', 'missing', 'busy', 'failed'])
    expect(cameraProblem('not an error')).toBe('failed')
  })
})

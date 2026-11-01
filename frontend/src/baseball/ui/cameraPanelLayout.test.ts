import { describe, expect, it } from 'vitest'
import {
  type CameraPanelState,
  cameraPanelLayout,
  cameraScreen,
  derbyKeyAction,
  MIN_PANEL_WIDTH,
  nextPanelSize,
  PANEL_EDGE,
  PANEL_SHARES,
  readPanelSize,
  savePanelSize,
} from './cameraPanelLayout'

const LAPTOP = { width: 1440, height: 900 }
const PLAYING: CameraPanelState = { screen: 'play', chasing: false, searching: false, size: 'medium' }

/** Where the panel goes, for a right-handed batter on a laptop screen. */
function placementOf(state: Partial<CameraPanelState>) {
  return cameraPanelLayout({ ...PLAYING, ...state }, LAPTOP, 'right').placement
}

/** A store that throws on every call, as when the browser blocks storage. */
const blockedStore = {
  getItem: () => {
    throw new DOMException('blocked', 'SecurityError')
  },
  setItem: () => {
    throw new DOMException('blocked', 'SecurityError')
  },
}

describe('the camera panel layout', () => {
  it('is the stage while the camera sets up, beside the play from practice on, a chip in a chase, hidden after', () => {
    const steps = ['setup', 'practice', 'practiceDone', 'play', 'result'] as const
    expect(steps.map((step) => cameraScreen(true, step))).toEqual(['setup', 'play', 'play', 'play', 'result'])
    expect(cameraScreen(false, 'play')).toBe(null)
    expect(placementOf({ screen: 'setup', size: 'off' })).toBe('stage')
    expect(placementOf({})).toBe('side')
    expect(placementOf({ chasing: true })).toBe('chip')
    expect(placementOf({ screen: 'result', searching: true })).toBe('hidden')
    expect(placementOf({ screen: null })).toBe('hidden')
  })

  it('hides when the visitor turns it off, but never while the camera is looking for them', () => {
    expect(placementOf({ size: 'off' })).toBe('hidden')
    expect(placementOf({ size: 'off', chasing: true })).toBe('hidden')
    expect(placementOf({ size: 'off', searching: true })).toBe('side')
    expect(placementOf({ size: 'off', searching: true, chasing: true })).toBe('chip')
    expect(cameraPanelLayout({ ...PLAYING, size: 'off', searching: true }, LAPTOP, 'right').width).toBeGreaterThan(0)
  })

  it('stands opposite the batter and centres the play in the band it leaves free', () => {
    const right = cameraPanelLayout(PLAYING, LAPTOP, 'right')
    const left = cameraPanelLayout(PLAYING, LAPTOP, 'left')
    expect([right.side, left.side]).toEqual(['right', 'left'])
    const span = PANEL_EDGE + right.width
    expect(right.band).toEqual({ centre: (LAPTOP.width - span) / 2, width: LAPTOP.width - span })
    expect(left.band).toEqual({ centre: span + (LAPTOP.width - span) / 2, width: LAPTOP.width - span })
    const fullWidth = { centre: LAPTOP.width / 2, width: LAPTOP.width }
    expect(cameraPanelLayout({ ...PLAYING, chasing: true }, LAPTOP, 'right').band).toEqual(fullWidth)
    expect(cameraPanelLayout({ ...PLAYING, size: 'off' }, LAPTOP, 'right').band).toEqual(fullWidth)
  })

  it('grows with V, keeps a very wide screen’s picture under the HUD, and hides when too narrow to read', () => {
    const medium = cameraPanelLayout(PLAYING, LAPTOP, 'right').width
    const large = cameraPanelLayout({ ...PLAYING, size: 'large' }, LAPTOP, 'right').width
    expect(medium).toBe(Math.floor(PANEL_SHARES.medium * LAPTOP.width))
    expect(large).toBeGreaterThan(medium)
    const ultrawide = cameraPanelLayout(PLAYING, { width: 3840, height: 1080 }, 'right')
    expect(ultrawide.width * 0.75).toBeLessThanOrEqual(1080 * 0.6)
    const narrow = cameraPanelLayout(PLAYING, { width: 600, height: 900 }, 'right')
    expect(narrow.width).toBeLessThan(MIN_PANEL_WIDTH)
    expect(narrow.placement).toBe('hidden')
    expect(narrow.band.width).toBe(600)
  })

  it('starts medium, cycles medium, large, off with V, and remembers the pick, even where storage is blocked', () => {
    expect([nextPanelSize('medium'), nextPanelSize('large'), nextPanelSize('off')]).toEqual(['large', 'off', 'medium'])
    const stored = new Map<string, string>()
    const store = { getItem: (key: string) => stored.get(key) ?? null, setItem: stored.set.bind(stored) }
    expect(readPanelSize(store)).toBe('medium')
    savePanelSize('off', store)
    expect(readPanelSize(store)).toBe('off')
    stored.forEach((_, key) => stored.set(key, 'huge'))
    expect(readPanelSize(store)).toBe('medium')
    expect(readPanelSize(blockedStore)).toBe('medium')
    expect(() => savePanelSize('large', blockedStore)).not.toThrow()
    expect(readPanelSize(null)).toBe('medium')
  })

  it('takes no key as a swing or a go: Space and Enter press the focused button, Esc leaves, V sizes the panel', () => {
    const keys = [' ', 'Enter', 'v', 'Escape', 'ArrowUp', 's'].map((key) => ({
      key,
      code: key === 'v' ? 'KeyV' : key,
      repeat: false,
      altKey: false,
      ctrlKey: false,
      metaKey: false,
    }))
    const screens = ['setup', 'play', 'result', null] as const
    const actions = screens.map((screen) => keys.map((event) => derbyKeyAction(event, screen)))
    expect(actions).toEqual([
      [null, null, null, 'leave', null, null],
      [null, null, 'cameraPanel', 'leave', null, null],
      [null, null, null, 'leave', null, null],
      [null, null, null, 'leave', null, null],
    ])
  })
})

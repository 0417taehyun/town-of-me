import { describe, expect, it } from 'vitest'
import { HUD_RESERVE } from '../stage/cameraShots'
import {
  type CameraPanelState,
  cameraPanelLayout,
  cameraScreen,
  derbyKeyAction,
  nextPanelSize,
  PANEL_EDGE,
  readPanelSize,
  savePanelSize,
} from './cameraPanelLayout'

const LAPTOP = { width: 1440, height: 900 }
const PLAYING: CameraPanelState = { screen: 'play', chasing: false, searching: false, waiting: false, size: 'medium' }

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
  it('is the stage in setup, beside the play from practice on, a chip in a chase, hidden when off or too narrow to read', () => {
    const steps = ['setup', 'practice', 'practiceDone', 'play', 'result'] as const
    expect(steps.map((step) => cameraScreen(true, step))).toEqual(['setup', 'play', 'play', 'play', 'result'])
    expect(cameraScreen(false, 'play')).toBe(null)
    expect(placementOf({ screen: 'setup', size: 'off' })).toBe('stage')
    expect(placementOf({})).toBe('side')
    expect(placementOf({ chasing: true })).toBe('chip')
    expect(placementOf({ screen: null })).toBe('hidden')
    const narrow = cameraPanelLayout(PLAYING, { width: 600, height: 900 }, 'right')
    expect([narrow.placement, narrow.band.width]).toEqual(['hidden', 600])
  })

  it('comes back at medium while a step waits for the stance, after practice or a run, though the visitor hid it', () => {
    for (const screen of ['play', 'result'] as const) {
      const hidden = cameraPanelLayout({ ...PLAYING, screen, waiting: true, size: 'off' }, LAPTOP, 'right')
      expect(hidden.placement).toBe('side')
      expect(hidden.width).toBe(cameraPanelLayout(PLAYING, LAPTOP, 'right').width)
      expect(hidden.band.width).toBe(LAPTOP.width - PANEL_EDGE - hidden.width)
    }
    expect(placementOf({ screen: 'result', waiting: true, size: 'large' })).toBe('side')
    expect(placementOf({ screen: 'result', size: 'off' })).toBe('hidden')
  })

  it('hides when the visitor turns it off, but never while the camera is looking for them', () => {
    expect(placementOf({ size: 'off' })).toBe('hidden')
    expect(placementOf({ size: 'off', chasing: true })).toBe('hidden')
    expect(placementOf({ size: 'off', searching: true })).toBe('side')
    expect(placementOf({ size: 'off', searching: true, chasing: true })).toBe('chip')
    expect(cameraPanelLayout({ ...PLAYING, size: 'off', searching: true }, LAPTOP, 'right').width).toBeGreaterThan(0)
  })

  it('keeps the scoreboard over the panel clear of the pitch line, at one size through a home run’s chase', () => {
    const clear = HUD_RESERVE.centre * LAPTOP.height
    const right = cameraPanelLayout(PLAYING, LAPTOP, 'right')
    expect(LAPTOP.width - PANEL_EDGE - right.scoreboardRoom).toBeCloseTo(right.band.centre + clear)
    const left = cameraPanelLayout(PLAYING, LAPTOP, 'left')
    expect(PANEL_EDGE + left.scoreboardRoom).toBeCloseTo(left.band.centre - clear)
    const off = cameraPanelLayout({ ...PLAYING, size: 'off' }, LAPTOP, 'right')
    expect(LAPTOP.width - PANEL_EDGE - off.scoreboardRoom).toBeCloseTo(off.band.centre + clear)
    expect(cameraPanelLayout({ ...PLAYING, chasing: true }, LAPTOP, 'right').scoreboardRoom).toBe(right.scoreboardRoom)
  })

  it('grows with V', () => {
    const medium = cameraPanelLayout(PLAYING, LAPTOP, 'right').width
    expect(cameraPanelLayout({ ...PLAYING, size: 'large' }, LAPTOP, 'right').width).toBeGreaterThan(medium)
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

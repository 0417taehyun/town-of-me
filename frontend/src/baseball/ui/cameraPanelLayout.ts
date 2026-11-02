import type { DerbyStep } from '../flow/derbyFlow'
import type { BattingSide } from '../game/field'
import { type FreeBand, HUD_RESERVE } from '../stage/cameraShots'

// Where the camera panel goes on each screen of a camera run, and how wide it is. While the camera sets up, the
// mirrored camera is the stage. Through practice and the run the panel hangs in a column under the scoreboard on the
// side opposite the batter, at the size the visitor picks with V (remembered in this browser), and the play is centred
// in the band it leaves free. It shrinks to a corner chip while the camera chases a home run, and hides whenever the
// camera is off. It never hides while the camera is looking for the visitor, who has to see it to step back into view,
// nor while a step waits for their batting stance (after practice, and on the result screen, which has no V to bring it
// back), so they see the stance they take. V is one of the two keys the derby's page takes itself (derbyKeyAction).

export type CameraPanelPlacement = 'stage' | 'side' | 'chip' | 'hidden'

export type CameraPanelSize = 'large' | 'medium' | 'off'

export type CameraScreen = 'setup' | 'play' | 'result'

export type PanelSide = 'left' | 'right'

export type Viewport = { width: number; height: number }

/** V's cycle, from the size a first visit starts at. */
export const CAMERA_PANEL_SIZES: readonly CameraPanelSize[] = ['medium', 'large', 'off']

/** The side panel's width as a share of the screen's. */
export const PANEL_SHARES = { large: 0.36, medium: 0.29 }

/** The narrowest side panel (px) whose picture and state still read from a step back; a narrower one hides instead. */
export const MIN_PANEL_WIDTH = 180

/** The panel's gap to the screen's edge (px), which baseball.css reads as `--camera-panel-edge`. */
export const PANEL_EDGE = 16

/**
 * The tallest the panel's 4:3 picture may be, as a share of the screen's height, so on a wide screen the panel, with its
 * chip above the picture and three lines under it, still fits between the scoreboard over it and the screen's bottom.
 */
export const PANEL_MAX_HEIGHT_SHARE = 0.41

export const PANEL_ASPECT = 4 / 3

/** Where this browser keeps the size picked for the side layout, the only layout so far. */
export const PANEL_SIZE_KEY = 'town-of-me:baseball:camera-panel:side'

type SizeStore = Pick<Storage, 'getItem' | 'setItem'>

export type CameraPanelState = {
  /** The screen the camera is on for, or null while the camera is off. */
  screen: CameraScreen | null
  /** The camera is following a home run's flight. */
  chasing: boolean
  /** The camera is on and does not see the visitor. */
  searching: boolean
  /** A step waits for the visitor's batting stance. */
  waiting: boolean
  /** The size the visitor picked with V. */
  size: CameraPanelSize
}

/** Where the panel goes and how wide it is, the band it leaves the play, and the scoreboard's room (scoreboardRoom). */
export type CameraPanelLayout = {
  placement: CameraPanelPlacement
  side: PanelSide
  width: number
  band: FreeBand
  scoreboardRoom: number
}

/**
 * The camera's screen for the derby's step: setting up until practice starts, then the play through practice and the
 * run, then its result; null while the camera is off.
 */
export function cameraScreen(cameraOn: boolean, step: DerbyStep): CameraScreen | null {
  if (!cameraOn) return null
  if (step === 'rules' || step === 'setup') return 'setup'
  return step === 'result' ? 'result' : 'play'
}

export function cameraPanelPlacement(state: CameraPanelState): CameraPanelPlacement {
  if (state.screen === 'setup') return 'stage'
  if (state.screen === null || shownPanelSize(state) === 'off') return 'hidden'
  return state.chasing ? 'chip' : 'side'
}

/** The size on screen: a panel the visitor hid comes back at medium while the camera looks for them or a step waits. */
export function shownPanelSize({ searching, waiting, size }: CameraPanelState): CameraPanelSize {
  return size === 'off' && (searching || waiting) ? 'medium' : size
}

/** The side panel's width (px) at `size`, or 0 when it is off or would be too narrow to read. */
export function sidePanelWidth(size: CameraPanelSize, viewport: Viewport) {
  if (size === 'off') return 0
  const tallest = PANEL_MAX_HEIGHT_SHARE * viewport.height * PANEL_ASPECT
  const width = Math.min(PANEL_SHARES[size] * viewport.width, tallest)
  return width < MIN_PANEL_WIDTH ? 0 : Math.floor(width)
}

/** The panel stands on the side opposite the batter: a right-handed batter is on the screen's left. */
export function panelSideFor(battingSide: BattingSide): PanelSide {
  return battingSide === 'right' ? 'right' : 'left'
}

/** The band of a `viewportWidth` screen beside a panel that takes `panelSpan` px from its `side` edge. */
export function freeBand(viewportWidth: number, panelSpan: number, side: PanelSide): FreeBand {
  const width = Math.max(0, viewportWidth - panelSpan)
  const left = side === 'left' ? viewportWidth - width : 0
  return { centre: left + width / 2, width }
}

/**
 * The panel's placement and width, and the band the play is centred in: only a side panel takes room from the play;
 * the stage is the setup screen's, and the chip sits over a corner of the chase.
 */
export function cameraPanelLayout(
  state: CameraPanelState,
  viewport: Viewport,
  battingSide: BattingSide,
): CameraPanelLayout {
  const side = panelSideFor(battingSide)
  const placement = cameraPanelPlacement(state)
  const width = placement === 'side' ? sidePanelWidth(shownPanelSize(state), viewport) : 0
  const shown = placement === 'side' && width === 0 ? 'hidden' : placement
  const panelSpan = width > 0 ? PANEL_EDGE + width : 0
  const band = freeBand(viewport.width, panelSpan, side)
  return { placement: shown, side, width, band, scoreboardRoom: scoreboardRoom(state, viewport) }
}

/**
 * The room (px) along the top of the screen for the scoreboard over the panel's side: from that edge to the batting
 * shot's pitch line, which stands in the centre of the play's band, less HUD_RESERVE.centre. It is measured beside the
 * side panel at the size shown, even while the panel is a chip during a chase, so the scores keep their size through a
 * home run's flight.
 */
export function scoreboardRoom(state: CameraPanelState, viewport: Viewport) {
  const width = sidePanelWidth(shownPanelSize(state), viewport)
  const panelSpan = width > 0 ? PANEL_EDGE + width : 0
  return (viewport.width + panelSpan) / 2 - PANEL_EDGE - HUD_RESERVE.centre * viewport.height
}

export function nextPanelSize(size: CameraPanelSize) {
  const index = CAMERA_PANEL_SIZES.indexOf(size)
  return CAMERA_PANEL_SIZES[(index + 1) % CAMERA_PANEL_SIZES.length]
}

/** This browser's store for the panel size, or null where the browser blocks storage (even reading it can throw). */
export function browserLocalStore(): SizeStore | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** The size the visitor last picked in this browser; a first visit, an unknown value, or blocked storage start medium. */
export function readPanelSize(store: SizeStore | null = browserLocalStore()): CameraPanelSize {
  try {
    const stored = store?.getItem(PANEL_SIZE_KEY)
    return CAMERA_PANEL_SIZES.find((size) => size === stored) ?? CAMERA_PANEL_SIZES[0]
  } catch {
    return CAMERA_PANEL_SIZES[0]
  }
}

export function savePanelSize(size: CameraPanelSize, store: SizeStore | null = browserLocalStore()) {
  try {
    store?.setItem(PANEL_SIZE_KEY, size)
  } catch {
    // The size still holds for this visit.
  }
}

/**
 * The key at `code` on any keyboard layout (a Korean one types ㅍ at V), unless it is held down or a modifier makes it
 * a shortcut such as paste.
 */
export function isPlainKey(
  event: Pick<KeyboardEvent, 'code' | 'repeat' | 'altKey' | 'ctrlKey' | 'metaKey'>,
  code: string,
) {
  return event.code === code && !event.repeat && !event.altKey && !event.ctrlKey && !event.metaKey
}

export type DerbyKeyAction = 'leave' | 'cameraPanel'

/**
 * What a key does on the derby's page, wherever focus is: Escape leaves, and V resizes or hides the camera panel beside
 * the play. Nothing else: Enter and Space press the focused button as on any page, so no key goes on by itself, and no
 * key swings: only the camera does.
 */
export function derbyKeyAction(
  event: Pick<KeyboardEvent, 'key' | 'code' | 'repeat' | 'altKey' | 'ctrlKey' | 'metaKey'>,
  screen: CameraScreen | null,
): DerbyKeyAction | null {
  if (event.key === 'Escape') return 'leave'
  return screen === 'play' && isPlainKey(event, 'KeyV') ? 'cameraPanel' : null
}

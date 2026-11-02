import type { CanvasTexture } from 'three'
import { type DerbyHudState, scoreboardTotals } from '../ui/derbyCues'
import { redrawCanvasTexture } from '../../scene/venues/ballpark/ballparkTextures'

// The treehouse scoreboard over center field. It counts only pitches whose balls have come down, as the HUD's figures
// do, so it never tells a pitch's result (let alone its type, which it never shows) while the ball is still in play.

/** A star per pitch, filled once that pitch is over; the home runs so far and their summed distance, as the HUD's. */
export type ScoreboardSummary = {
  pitches: number
  played: number
  homeRuns: number
  homeRunDistanceDecimetres: number
}

export function scoreboardSummary(hud: DerbyHudState, pitchCount: number): ScoreboardSummary {
  const { homeRuns, homeRunDistanceDecimetres } = scoreboardTotals(hud)
  return {
    pitches: pitchCount,
    played: Math.min(hud.results.length, hud.settledPitch + 1),
    homeRuns,
    homeRunDistanceDecimetres,
  }
}

/** What the board says, already in the visitor's language. */
export type ScoreboardText = { title: string; homeRuns: string; distance: string }

export const SCOREBOARD_FONT = "'Pretendard Variable', Pretendard, -apple-system, system-ui, sans-serif"
const BOARD_GREEN = '#2f4a3c'
const CREAM = '#f8f3e7'
const BUTTER = '#f2dc92'
const BLUSH = '#f3c6d0'

/** Draws the board on a 1024 × 512 canvas: the title, a row of stars, the home runs, and their summed distance. */
export function drawScoreboard(context: CanvasRenderingContext2D, summary: ScoreboardSummary, text: ScoreboardText) {
  const { width, height } = context.canvas
  context.fillStyle = BOARD_GREEN
  context.fillRect(0, 0, width, height)
  context.strokeStyle = 'rgba(248, 243, 231, 0.75)'
  context.lineWidth = 6
  context.setLineDash([18, 10])
  context.strokeRect(22, 22, width - 44, height - 44)
  context.setLineDash([])
  context.textAlign = 'center'
  context.textBaseline = 'alphabetic'
  context.fillStyle = BUTTER
  context.font = `900 64px ${SCOREBOARD_FONT}`
  context.fillText(text.title, width / 2, 110)
  const gap = Math.min(120, (width - 160) / Math.max(1, summary.pitches))
  Array.from({ length: summary.pitches }, (_, index) => index).forEach((index) =>
    drawStar(context, width / 2 + (index - (summary.pitches - 1) / 2) * gap, 200, index < summary.played),
  )
  context.fillStyle = CREAM
  context.font = `900 92px ${SCOREBOARD_FONT}`
  context.fillText(text.homeRuns, width * 0.3, 380)
  context.fillStyle = BLUSH
  context.font = `800 84px ${SCOREBOARD_FONT}`
  context.fillText(text.distance, width * 0.72, 380)
}

/** A five-pointed star, gold once its pitch is over and a faint outline before. */
export function drawStar(context: CanvasRenderingContext2D, x: number, y: number, filled: boolean) {
  context.beginPath()
  Array.from({ length: 10 }, (_, point) => point).forEach((point) => {
    const radius = point % 2 === 0 ? 40 : 17
    const angle = -Math.PI / 2 + (point * Math.PI) / 5
    context.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius)
  })
  context.closePath()
  context.fillStyle = filled ? BUTTER : 'rgba(248, 243, 231, 0.14)'
  context.fill()
  context.strokeStyle = filled ? BUTTER : 'rgba(248, 243, 231, 0.45)'
  context.lineWidth = 4
  context.stroke()
}

/** Draws the board on its texture's canvas and has the texture uploaded again. */
export function redrawScoreboard(texture: CanvasTexture, summary: ScoreboardSummary, text: ScoreboardText) {
  redrawCanvasTexture(texture, (context) => drawScoreboard(context, summary, text))
}

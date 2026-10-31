import { CanvasTexture, SRGBColorSpace } from 'three'

const SIGN_HEIGHT = 160
const SIGN_FONT = "800 92px 'Pretendard Variable', Pretendard, system-ui, sans-serif"
const FALLBACK_FONT = '800 92px system-ui, sans-serif'

/**
 * A painted wooden sign in the guestbook's colors: a cream face, a brown border, and bold brown lettering. Until the
 * web font has loaded the sign uses the system font, and it is drawn again once `webFontReady`.
 */
export function drawSignTexture(text: string, webFontReady: boolean) {
  const font = webFontReady ? SIGN_FONT : FALLBACK_FONT
  const canvas = document.createElement('canvas')
  const measure = canvas.getContext('2d')!
  measure.font = font
  canvas.width = Math.ceil(measure.measureText(text).width) + 130
  canvas.height = SIGN_HEIGHT
  const context = canvas.getContext('2d')!
  context.fillStyle = '#fff0bd'
  context.strokeStyle = '#6c422d'
  context.lineWidth = 12
  context.beginPath()
  context.roundRect(6, 6, canvas.width - 12, SIGN_HEIGHT - 12, 26)
  context.fill()
  context.stroke()
  context.font = font
  context.fillStyle = '#4b2d1e'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(text, canvas.width / 2, SIGN_HEIGHT / 2 + 4)
  const texture = new CanvasTexture(canvas)
  texture.colorSpace = SRGBColorSpace
  texture.anisotropy = 4
  return { texture, aspect: canvas.width / SIGN_HEIGHT }
}

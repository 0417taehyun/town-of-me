import { PerformanceMonitor } from '@react-three/drei'
import { Canvas, type CanvasProps } from '@react-three/fiber'
import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { type AppLanguage, languageCopy } from '../i18n/language'
import { FRAME_RATE_BOUNDS, PIXEL_RATIO_FACTOR, pixelRatioFor } from './renderQuality'
import { CHROME_GRAPHICS_SETTINGS, copyStatus, copyText, supportsWebGL } from './webglSupport'

/**
 * A button that copies `address`, the address itself to select and copy by hand, and a status line: `messages.untried`
 * until the button is pressed, then whether the copy worked (copyStatus).
 */
export function CopyAddress({
  address,
  copyLabel,
  addressLabel,
  messages,
}: {
  address: string
  copyLabel: string
  addressLabel: string
  messages: Parameters<typeof copyStatus>[1]
}) {
  const [copied, setCopied] = useState<boolean | null>(null)
  return (
    <>
      <button
        className="primary-button compact"
        type="button"
        onClick={() => void copyText(address, navigator.clipboard).then(setCopied)}
      >
        {copyLabel}
      </button>
      <input
        className="graphics-settings-address"
        aria-label={addressLabel}
        value={address}
        readOnly
        onFocus={(event) => event.currentTarget.select()}
      />
      <small role="status">{copyStatus(copied, messages)}</small>
    </>
  )
}

export function GraphicsFallback({ language, preview = false }: { language: AppLanguage; preview?: boolean }) {
  const copy = languageCopy[language].graphics
  return (
    <div className={`webgl-fallback ${preview ? 'preview-fallback' : ''}`} role="alert">
      <strong>{preview ? copy.preview : copy.town}</strong>
      <p>{copy.description}</p>
      <CopyAddress
        address={CHROME_GRAPHICS_SETTINGS}
        copyLabel={copy.copy}
        addressLabel={copy.addressLabel}
        messages={{ untried: copy.pasteHint, copied: copy.copied, byHand: copy.copyByHand }}
      />
      <button className="text-button" type="button" onClick={() => window.location.reload()}>
        {copy.reload}
      </button>
    </div>
  )
}

class GraphicsBoundary extends Component<
  { children: ReactNode; language: AppLanguage; preview: boolean; onFailed: () => void },
  { failed: boolean }
> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    this.props.onFailed()
  }
  render() {
    if (this.state.failed) return <GraphicsFallback language={this.props.language} preview={this.props.preview} />
    return this.props.children
  }
}

/**
 * A 3D canvas that shows the graphics fallback in `language` when WebGL 2 is missing, lost, or fails while drawing,
 * and then calls `onUnavailable`. The fallback replaces the canvas rather than sitting inside it as canvas fallback
 * content, which Chrome hands to screen readers even while WebGL works. Without a fixed `dpr`, it starts halfway between
 * a pixel ratio of 1 and the screen's own (at most 2), then steps a quarter up while the device holds 60 fps and a
 * quarter down while it cannot. After several changes it settles where it is, so the canvas stops resizing.
 */
export function GraphicsCanvas({
  language,
  preview = false,
  onCreated,
  onUnavailable,
  dpr,
  children,
  ...props
}: CanvasProps & { language: AppLanguage; preview?: boolean; onUnavailable?: () => void }) {
  const [supported, setSupported] = useState(() =>
    supportsWebGL(() => document.createElement('canvas').getContext('webgl2')),
  )
  // Read through globalThis because the fallback is also rendered to static markup, where there is no window.
  const [pixelRatio, setPixelRatio] = useState(() =>
    pixelRatioFor(PIXEL_RATIO_FACTOR.start, globalThis.devicePixelRatio ?? 1),
  )
  const stepPixelRatio = ({ factor }: { factor: number }) =>
    setPixelRatio(pixelRatioFor(factor, window.devicePixelRatio))
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const contextLost = useCallback((event: Event) => {
    event.preventDefault()
    setSupported(false)
  }, [])
  useEffect(() => () => canvas.current?.removeEventListener('webglcontextlost', contextLost), [contextLost])
  useEffect(() => {
    if (supported) return
    onUnavailable?.()
  }, [onUnavailable, supported])
  if (!supported) return <GraphicsFallback language={language} preview={preview} />
  return (
    <GraphicsBoundary language={language} preview={preview} onFailed={() => setSupported(false)}>
      <Canvas
        {...props}
        dpr={dpr ?? pixelRatio}
        onCreated={(state) => {
          canvas.current = state.gl.domElement
          canvas.current.addEventListener('webglcontextlost', contextLost)
          onCreated?.(state)
        }}
      >
        {!dpr && (
          <PerformanceMonitor
            factor={PIXEL_RATIO_FACTOR.start}
            step={PIXEL_RATIO_FACTOR.step}
            bounds={() => FRAME_RATE_BOUNDS}
            flipflops={6}
            // Not onChange: drei compares against a last factor that every render resets to 0, so a step down to 0
            // would never arrive there and a slow phone would stay at 1.25.
            onIncline={stepPixelRatio}
            onDecline={stepPixelRatio}
          />
        )}
        {children}
      </Canvas>
    </GraphicsBoundary>
  )
}

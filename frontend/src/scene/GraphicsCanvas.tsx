import { PerformanceMonitor } from '@react-three/drei'
import { Canvas, type CanvasProps } from '@react-three/fiber'
import { Component, useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { type AppLanguage, languageCopy } from '../i18n/language'
import { CHROME_GRAPHICS_SETTINGS, copyStatus, copyText, supportsWebGL } from './webglSupport'

/** The sharpest pixel ratio a scene renders at; devices that cannot hold the frame rate drop to 1. */
const SHARP_PIXEL_RATIO = 1.35

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
 * content, which Chrome hands to screen readers even while WebGL works. Without a fixed `dpr`, it renders up to
 * SHARP_PIXEL_RATIO and drops to 1 while the device cannot hold the frame rate.
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
  const [sharpest, setSharpest] = useState(SHARP_PIXEL_RATIO)
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
        dpr={dpr ?? [1, sharpest]}
        onCreated={(state) => {
          canvas.current = state.gl.domElement
          canvas.current.addEventListener('webglcontextlost', contextLost)
          onCreated?.(state)
        }}
      >
        {!dpr && (
          <PerformanceMonitor
            flipflops={3}
            onDecline={() => setSharpest(1)}
            onIncline={() => setSharpest(SHARP_PIXEL_RATIO)}
            onFallback={() => setSharpest(1)}
          />
        )}
        {children}
      </Canvas>
    </GraphicsBoundary>
  )
}

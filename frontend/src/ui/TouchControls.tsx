import { useCallback, useEffect, useRef } from 'react'
import type { MutableRefObject, PointerEvent as ReactPointerEvent } from 'react'
import type { AppLanguage } from '../i18n/language'
import { languageCopy } from '../i18n/language'
import { claimControlPointer, releaseControlPointer } from '../scene/controls'

export function VirtualStick({
  movementRef,
  language,
}: {
  movementRef: MutableRefObject<{ x: number; y: number }>
  language: AppLanguage
}) {
  const knob = useRef<HTMLSpanElement>(null)
  const activePointer = useRef<number | null>(null)
  const bounds = useRef({ left: 0, top: 0, width: 0, height: 0 })

  const update = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = bounds.current
    const x = event.clientX - rect.left - rect.width / 2
    const y = event.clientY - rect.top - rect.height / 2
    const distance = Math.hypot(x, y)
    const limit = 34
    const scale = distance > limit ? limit / distance : 1
    movementRef.current.x = (x * scale) / limit
    movementRef.current.y = (-y * scale) / limit
    if (knob.current) knob.current.style.transform = `translate(${x * scale}px, ${y * scale}px)`
  }

  const clear = useCallback(() => {
    activePointer.current = null
    movementRef.current.x = 0
    movementRef.current.y = 0
    if (knob.current) knob.current.style.transform = 'translate(0, 0)'
  }, [movementRef])

  const release = (event: ReactPointerEvent<HTMLDivElement>) => {
    activePointer.current = releaseControlPointer(activePointer.current, event.pointerId)
    if (activePointer.current !== null) return
    clear()
  }

  useEffect(() => {
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('blur', clear)
      clear()
    }
  }, [clear])

  return (
    <div
      className="virtual-stick"
      aria-label={languageCopy[language].touch.movement}
      onPointerDown={(event) => {
        event.preventDefault()
        event.stopPropagation()
        activePointer.current = claimControlPointer(activePointer.current, event.pointerId)
        if (activePointer.current !== event.pointerId) return
        bounds.current = event.currentTarget.getBoundingClientRect()
        event.currentTarget.setPointerCapture(event.pointerId)
        update(event)
      }}
      onPointerMove={(event) => {
        if (activePointer.current !== event.pointerId) return
        event.preventDefault()
        event.stopPropagation()
        update(event)
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onContextMenu={(event) => event.preventDefault()}
    >
      <span ref={knob} />
    </div>
  )
}

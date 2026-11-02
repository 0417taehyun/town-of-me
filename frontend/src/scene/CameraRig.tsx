import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { MathUtils, PerspectiveCamera, Vector3, type Vector3Tuple } from 'three'
import type { MutableRefObject } from 'react'
import { CAMERA_EYE_TARGET_HEIGHT, type CameraSettings } from '../camera/cameraConfig'
import { adjustFovByInputDelta, cameraOffset, clampGlance, clampYaw } from '../camera/cameraMath'
import { damp, dampingAlpha } from '../motionMath'
import { measurePinch, type ScreenPoint } from './controls'

/** How much closer the camera moves while the player talks, as a share of the follow distance. */
const DIALOGUE_ZOOM = 0.28
const DIALOGUE_EASE_SPEED = 2.4

type Props = {
  settings: CameraSettings
  playerPosition: MutableRefObject<Vector3>
  movementDirection: MutableRefObject<Vector3>
  dampedTarget: MutableRefObject<Vector3>
  lookAheadTarget: MutableRefObject<Vector3>
  resetKey: number
  reducedMotion: boolean
  onFovChange: (fov: number) => void
  onGlance: () => void
  onViewAdjusted: () => void
  /** The actor in conversation with the player, for the camera to frame. */
  dialogueFocusRef: MutableRefObject<Vector3 | null>
}

export function CameraRig({
  settings,
  playerPosition,
  movementDirection,
  dampedTarget,
  lookAheadTarget,
  resetKey,
  reducedMotion,
  onFovChange,
  onGlance,
  onViewAdjusted,
  dialogueFocusRef,
}: Props) {
  const { camera, gl } = useThree()
  const yaw = useRef(0)
  const pitch = useRef(0)
  const dragging = useRef(false)
  const lastX = useRef(0)
  const lastY = useRef(0)
  const pointers = useRef(new Map<number, ScreenPoint>())
  const pinchDistance = useRef(0)
  const gestureFov = useRef(settings.fov)
  const glanceDistance = useRef(0)
  const viewAdjustmentDistance = useRef(0)
  const glanceReported = useRef(false)
  const viewAdjustmentReported = useRef(false)
  const releasedAt = useRef(0)
  const initialized = useRef(false)
  const desiredPosition = useRef(new Vector3())
  const desiredTarget = useRef(new Vector3())
  const lookAhead = useRef(new Vector3())
  const dampedLookAhead = useRef(new Vector3())
  const verticalAnchor = useRef(playerPosition.current.y)
  const smoothedHeight = useRef(settings.height)
  const offset = useRef<Vector3Tuple>([0, 0, 0])
  const dialogueBlend = useRef(0)
  // Kept after the conversation ends so the framing eases back out from where it was.
  const dialogueShift = useRef(new Vector3())
  const appliedDialogueShift = useRef(new Vector3())

  useEffect(() => {
    initialized.current = false
    yaw.current = 0
    pitch.current = 0
    verticalAnchor.current = playerPosition.current.y
  }, [playerPosition, resetKey])

  useEffect(() => {
    const canvas = gl.domElement
    const beginDrag = (event: PointerEvent, x: number, y: number) => {
      dragging.current = true
      lastX.current = x
      lastY.current = y
      glanceDistance.current = 0
      viewAdjustmentDistance.current = 0
      glanceReported.current = false
      viewAdjustmentReported.current = false
      canvas.setPointerCapture(event.pointerId)
      canvas.classList.add('is-dragging')
    }
    const touchDown = (event: PointerEvent) => {
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (pointers.current.size !== 2) return
      const [firstPointer, secondPointer] = [...pointers.current.values()]
      const pinch = measurePinch(firstPointer, secondPointer)
      pinchDistance.current = pinch.distance
      gestureFov.current = settings.fov
      beginDrag(event, pinch.x, pinch.y)
    }
    const pointerDown = (event: PointerEvent) => {
      if (event.pointerType === 'touch') {
        touchDown(event)
        return
      }
      if (event.button !== 0) return
      beginDrag(event, event.clientX, event.clientY)
    }
    const updateTouchGesture = (event: PointerEvent) => {
      if (!pointers.current.has(event.pointerId)) return null
      pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY })
      if (pointers.current.size !== 2) return null
      const [firstPointer, secondPointer] = [...pointers.current.values()]
      const pinch = measurePinch(firstPointer, secondPointer)
      const distanceChange = pinch.distance - pinchDistance.current
      gestureFov.current = adjustFovByInputDelta(gestureFov.current, distanceChange)
      viewAdjustmentDistance.current += Math.abs(distanceChange)
      pinchDistance.current = pinch.distance
      onFovChange(gestureFov.current)
      if (!viewAdjustmentReported.current && viewAdjustmentDistance.current >= 8) {
        viewAdjustmentReported.current = true
        onViewAdjusted()
      }
      return { x: pinch.x, y: pinch.y }
    }
    const pointerMove = (event: PointerEvent) => {
      if (!dragging.current) return
      const point = event.pointerType === 'touch' ? updateTouchGesture(event) : event
      if (!point) return
      const { x, y } = point
      glanceDistance.current += Math.hypot(x - lastX.current, y - lastY.current)
      if (!glanceReported.current && glanceDistance.current >= 12) {
        glanceReported.current = true
        onGlance()
      }
      yaw.current = clampYaw(yaw.current + (x - lastX.current) * 0.004, MathUtils.degToRad(settings.maxYaw))
      pitch.current = clampGlance(pitch.current + (y - lastY.current) * 0.003, MathUtils.degToRad(settings.maxPitch))
      lastX.current = x
      lastY.current = y
    }
    const pointerUp = (event: PointerEvent) => {
      pointers.current.delete(event.pointerId)
      if (event.pointerType === 'touch' && pointers.current.size >= 2) return
      dragging.current = false
      releasedAt.current = performance.now()
      canvas.classList.remove('is-dragging')
    }
    const wheel = (event: WheelEvent) => {
      event.preventDefault()
      const nextFov = adjustFovByInputDelta(settings.fov, event.deltaY)
      onFovChange(nextFov)
      if (nextFov !== settings.fov) onViewAdjusted()
    }
    canvas.addEventListener('pointerdown', pointerDown)
    canvas.addEventListener('pointermove', pointerMove)
    canvas.addEventListener('pointerup', pointerUp)
    canvas.addEventListener('pointercancel', pointerUp)
    canvas.addEventListener('wheel', wheel, { passive: false })
    return () => {
      canvas.removeEventListener('pointerdown', pointerDown)
      canvas.removeEventListener('pointermove', pointerMove)
      canvas.removeEventListener('pointerup', pointerUp)
      canvas.removeEventListener('pointercancel', pointerUp)
      canvas.removeEventListener('wheel', wheel)
    }
  }, [gl, onFovChange, onGlance, onViewAdjusted, settings.fov, settings.maxPitch, settings.maxYaw])

  useFrame((state, rawDelta) => {
    const activeCamera = state.camera
    if (activeCamera instanceof PerspectiveCamera && Math.abs(activeCamera.fov - settings.fov) > 0.001) {
      activeCamera.fov = damp(activeCamera.fov, settings.fov, 7, rawDelta)
      activeCamera.updateProjectionMatrix()
    }
    const delta = Math.min(rawDelta, 0.05)
    const speedMultiplier = reducedMotion ? 2 : 1
    if (!dragging.current && performance.now() - releasedAt.current > 800) {
      yaw.current = damp(yaw.current, 0, settings.yawReturnSpeed * speedMultiplier, delta)
      pitch.current = damp(pitch.current, 0, settings.yawReturnSpeed * speedMultiplier, delta)
    }

    // Frame the player and the resident together by aiming between them, a little closer.
    const dialogueFocus = reducedMotion ? null : dialogueFocusRef.current
    if (dialogueFocus)
      dialogueShift.current.subVectors(dialogueFocus, playerPosition.current).setY(0).multiplyScalar(0.5)
    dialogueBlend.current = damp(dialogueBlend.current, dialogueFocus ? 1 : 0, DIALOGUE_EASE_SPEED, delta)
    const shift = appliedDialogueShift.current.copy(dialogueShift.current).multiplyScalar(dialogueBlend.current)
    const distance = settings.distance * (1 - DIALOGUE_ZOOM * dialogueBlend.current)

    smoothedHeight.current = damp(smoothedHeight.current, settings.height, 3.2, delta)
    const [x, y, z] = cameraOffset(yaw.current, smoothedHeight.current, distance, offset.current)
    verticalAnchor.current = damp(verticalAnchor.current, playerPosition.current.y, 1.25, delta)
    desiredPosition.current.set(playerPosition.current.x + x, verticalAnchor.current + y, playerPosition.current.z + z)
    desiredPosition.current.add(shift)

    const movement = movementDirection.current
    const movementLength = movement.length()
    lookAhead.current.copy(movement).multiplyScalar(movementLength > 0.001 ? settings.lookAhead / movementLength : 0)
    dampedLookAhead.current.lerp(lookAhead.current, dampingAlpha(settings.targetFollowSpeed, delta))
    lookAheadTarget.current.set(
      playerPosition.current.x,
      verticalAnchor.current + CAMERA_EYE_TARGET_HEIGHT,
      playerPosition.current.z,
    )
    lookAheadTarget.current.add(dampedLookAhead.current)
    desiredTarget.current.copy(lookAheadTarget.current).add(shift)
    desiredTarget.current.y += Math.tan(pitch.current) * distance

    const positionAlpha = initialized.current ? dampingAlpha(settings.positionFollowSpeed * speedMultiplier, delta) : 1
    const targetAlpha = initialized.current ? dampingAlpha(settings.targetFollowSpeed * speedMultiplier, delta) : 1
    camera.position.lerp(desiredPosition.current, positionAlpha)
    dampedTarget.current.lerp(desiredTarget.current, targetAlpha)
    initialized.current = true
    camera.lookAt(dampedTarget.current)
  })

  return null
}

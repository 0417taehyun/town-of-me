import { Line, MapControls } from '@react-three/drei'
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  type ComponentRef,
  type MutableRefObject,
} from 'react'
import { InstancedMesh, MOUSE, Object3D, Plane, Raycaster, TOUCH, Vector2, Vector3 } from 'three'
import type { TownObject, TownPoint, TownSnapshot, Vec3 } from '../data/models'
import { useReducedMotion } from '../hooks/useReducedMotion'
import { TOWN_OBJECT_KINDS } from '../scene/objects/kinds'
import { getRoadWorldPoints } from '../scene/objects/roads/roadLayout'
import { openVenueSlots } from '../scene/venues/venuePlacements'
import { venueApproachOutline } from '../scene/venues/venueSlots'
import { getObjectOrigins, moveObjects } from './bulkEditing'
import {
  addToObjectSelection,
  getIdsInRectangle,
  getMarkerLayers,
  getSelectedObjectIds,
  glideToFocus,
  projectMarkers,
  toggleObjectSelection,
  type EditorCategory,
  type MarkerLook,
} from './objectSelection'
import {
  getBenchStop,
  getEditorCameraPose,
  getResidentWalk,
  getMarkerPosition,
  movePetRoutePoint,
  moveRoadPoint,
  moveRoutePoint,
  PET_SELECTION,
  type EditorSelection,
  type EditorView,
} from './townEditing'
import { getSelectedBlockedLegs } from './walkCrossings'

type MapControlsHandle = ComponentRef<typeof MapControls>

/**
 * The top view pans with a left drag like a map; the visitor view looks around with a left drag like a visitor's
 * glance and keeps the camera between the ground and eye level.
 */
const viewControls = {
  top: {
    minPolarAngle: 0,
    maxPolarAngle: 1.3,
    minDistance: 6,
    maxDistance: 150,
    mouseButtons: { LEFT: MOUSE.PAN, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.ROTATE },
    touches: { ONE: TOUCH.PAN, TWO: TOUCH.DOLLY_ROTATE },
  },
  visitor: {
    minPolarAngle: 0.9,
    maxPolarAngle: Math.PI / 2,
    minDistance: 1.5,
    maxDistance: 25,
    mouseButtons: { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN },
    touches: { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN },
  },
} as const

/** In select mode one finger picks markers, so only two fingers move the camera. */
const selectModeTouches = { TWO: TOUCH.DOLLY_ROTATE } as const

const markerLooks: Record<MarkerLook, { color: string; groundOpacity: number; skyOpacity: number; order: number }> = {
  open: { color: '#fff6d6', groundOpacity: 0.42, skyOpacity: 0.32, order: 4 },
  selected: { color: '#ffcf3f', groundOpacity: 0.85, skyOpacity: 0.7, order: 5 },
  dimmed: { color: '#c9cfcb', groundOpacity: 0.18, skyOpacity: 0.14, order: 3 },
}
const BLOCKED_LEG_COLOR = '#d9483b'
const VENUE_APPROACH_COLOR = '#fff6d6'
const DRAG_THRESHOLD_PIXELS = 4

type DragState = {
  pointerId: number
  startX: number
  startY: number
  moved: boolean
  plane: Plane
  offset: Vector3
  apply: (point: Vector3) => void
  /** Selects what a finger pressed once it drags; a mouse selected it on pressing, and a group stays selected. */
  selectOnDrag: () => void
  /** Selects what was pressed when it is let go without dragging: a finger's tap, or a click inside a group. */
  selectOnTap: () => void
}

/** A Shift press, or any press in select mode: a drag draws a box, and letting go in place toggles the marker. */
type PickState = { pointerId: number; startX: number; startY: number; boxing: boolean; pressedId: string | null }

/** One instanced marker per object, so every object can be picked even under a roof or in the sky. */
export function ObjectMarkers({
  objects,
  look,
  ground,
  onGrab,
}: {
  objects: TownObject[]
  /** Dimmed markers belong to another category and have no handlers, so the pointer passes through them. */
  look: MarkerLook
  ground: boolean
  onGrab: (event: ThreeEvent<PointerEvent>, objects: TownObject[]) => void
}) {
  const mesh = useRef<InstancedMesh>(null)
  const { color, groundOpacity, skyOpacity, order } = markerLooks[look]
  const dimmed = look === 'dimmed'
  useLayoutEffect(() => {
    const node = mesh.current
    if (!node) return
    const dummy = new Object3D()
    objects.forEach((object, index) => {
      const { x, y, z } = getMarkerPosition(object)
      const radius = TOWN_OBJECT_KINDS[object.type].markerRadius
      // Smaller markers float slightly higher so a flower beside a house stays clickable from above.
      dummy.position.set(x, ground ? 0.06 + 0.12 / radius : y, z)
      dummy.rotation.set(ground ? -Math.PI / 2 : 0, 0, 0)
      dummy.scale.setScalar(radius)
      dummy.updateMatrix()
      node.setMatrixAt(index, dummy.matrix)
    })
    node.instanceMatrix.needsUpdate = true
    node.computeBoundingSphere()
  }, [ground, objects])
  return (
    <instancedMesh
      key={objects.length}
      ref={mesh}
      args={[undefined, undefined, Math.max(1, objects.length)]}
      count={objects.length}
      renderOrder={order}
      onPointerDown={dimmed ? undefined : (event) => onGrab(event, objects)}
      onClick={dimmed ? undefined : (event) => event.stopPropagation()}
    >
      {ground ? <circleGeometry args={[1, 32]} /> : <sphereGeometry args={[1, 16, 12]} />}
      <meshBasicMaterial
        color={color}
        transparent
        opacity={ground ? groundOpacity : skyOpacity}
        depthWrite={false}
        toneMapped={false}
      />
    </instancedMesh>
  )
}

export function PointHandles({
  points,
  selectedIndex,
  lockedIndex,
  closed = false,
  color,
  onGrab,
}: {
  points: TownPoint[]
  selectedIndex: number | undefined
  lockedIndex?: number
  /** Draws the segment from the last point back to the first, for a loop. */
  closed?: boolean
  color: string
  onGrab: (event: ThreeEvent<PointerEvent>, index: number) => void
}) {
  const linePoints = closed ? [...points, points[0]] : points
  return (
    <>
      <Line points={linePoints.map(([x, z]) => [x, 0.18, z] as [number, number, number])} color={color} lineWidth={3} />
      {points.map(([x, z], index) => (
        <mesh
          key={index}
          position={[x, 0.6, z]}
          visible={index !== lockedIndex}
          onPointerDown={(event) => index !== lockedIndex && onGrab(event, index)}
          onClick={(event) => index !== lockedIndex && event.stopPropagation()}
        >
          <sphereGeometry args={[index === selectedIndex ? 0.75 : 0.55, 16, 12]} />
          <meshBasicMaterial color={index === selectedIndex ? '#ffcf3f' : color} toneMapped={false} />
        </mesh>
      ))}
    </>
  )
}

export function TownEditorScene({
  town,
  selection,
  view,
  category,
  selecting,
  viewCenter,
  focusTargetRef,
  onSelect,
  onGestureStart,
  onEdit,
}: {
  town: TownSnapshot
  selection: EditorSelection
  view: EditorView
  /** Only this category's markers can be picked; the others are faded. */
  category: EditorCategory
  /** Touch select mode: a tap adds or removes a marker and a drag selects a box, like Shift with a mouse. */
  selecting: boolean
  /** Kept in sync with the camera target so new objects appear in the middle of the view. */
  viewCenter: MutableRefObject<Vector3>
  /** Where the camera glides next; cleared once it arrives or the admin moves the camera. */
  focusTargetRef: MutableRefObject<Vec3 | null>
  onSelect: (selection: EditorSelection) => void
  onGestureStart: () => void
  /** Applies a dragged change to whatever town is current then; the drag's gesture already marked the undo step. */
  onEdit: (change: (town: TownSnapshot) => TownSnapshot) => void
}) {
  const camera = useThree((state) => state.camera)
  const domElement = useThree((state) => state.gl.domElement)
  const reducedMotion = useReducedMotion()
  const controls = useRef<MapControlsHandle>(null)
  const drag = useRef<DragState | null>(null)
  const pick = useRef<PickState | null>(null)
  const touches = useRef(new Set<number>())
  const selectedIds = useMemo(() => new Set(getSelectedObjectIds(selection)), [selection])
  const markerLayers = useMemo(
    () => getMarkerLayers(town.objects, category, selectedIds),
    [category, selectedIds, town.objects],
  )
  const single = selection?.kind === 'objects' ? null : selection
  const selectedObject = single?.kind === 'object' ? town.objects.find(({ id }) => id === single.id) : undefined
  const selectedResident = single?.kind === 'resident' ? town.residents.find(({ id }) => id === single.id) : null
  const benchStop = selectedResident ? getBenchStop(town, selectedResident) : null
  const petRoute = single?.kind === 'pet' ? town.pet.route : null
  const blockedLegs = useMemo(() => getSelectedBlockedLegs(town, selection), [selection, town])
  const venueApproaches = useMemo(() => openVenueSlots(town.venues).map(venueApproachOutline), [town.venues])
  // The visitor view shows the town as visitors see it, so editing markers and handles stay in the top view.
  const marking = view === 'top'
  // The people tab has no markers to pick, so select mode leaves its camera alone.
  const selectMode = marking && selecting && category !== 'people'
  const stopFocus = useCallback(() => {
    focusTargetRef.current = null
  }, [focusTargetRef])

  // Keeps the spot on the map and the heading when the view changes; the first run frames the saved view center.
  useLayoutEffect(() => {
    const pose = getEditorCameraPose(view, viewCenter.current, camera.position)
    camera.position.set(pose.position.x, pose.position.y, pose.position.z)
    controls.current?.target.set(pose.target.x, pose.target.y, pose.target.z)
    controls.current?.update()
  }, [camera, view, viewCenter])

  useFrame((state, delta) => {
    const handle = controls.current
    if (!handle) return
    const focus = focusTargetRef.current
    const step = reducedMotion ? Infinity : delta
    if (focus && glideToFocus(handle.target, state.camera.position, focus, step)) stopFocus()
    viewCenter.current.copy(handle.target)
  })

  const startsPick = useEffectEvent(
    (event: PointerEvent) =>
      marking && event.button === 0 && (event.shiftKey || selectMode) && touches.current.size <= 1,
  )
  const finishPick = useEffectEvent((picked: PickState, endX: number, endY: number) => {
    if (picked.boxing) {
      const open = markerLayers.filter(({ look }) => look !== 'dimmed').flatMap(({ objects }) => objects)
      const points = projectMarkers(open, camera, domElement.getBoundingClientRect())
      const boxed = getIdsInRectangle(points, { x: picked.startX, y: picked.startY }, { x: endX, y: endY })
      onSelect(addToObjectSelection(selection, boxed))
      return
    }
    if (picked.pressedId) onSelect(toggleObjectSelection(selection, picked.pressedId))
  })

  useEffect(() => {
    const raycaster = new Raycaster()
    const pointer = new Vector2()
    const hit = new Vector3()
    const box = document.createElement('div')
    box.className = 'editor-selection-box'
    box.hidden = true
    document.body.append(box)
    let frame = 0
    let pending: (() => void) | null = null
    const flush = () => {
      frame = 0
      pending?.()
      pending = null
    }
    const setControlsEnabled = (enabled: boolean) => {
      if (controls.current) controls.current.enabled = enabled
    }
    const cancelPick = () => {
      pick.current = null
      box.hidden = true
      setControlsEnabled(true)
    }
    // Capturing runs before the controls' and the scene's own handlers, so a press can claim the pointer first.
    const press = (event: PointerEvent) => {
      if (event.pointerType === 'touch') touches.current.add(event.pointerId)
      // A second finger turns a press that has not dragged yet, or a box being drawn, into a camera gesture.
      if (drag.current && !drag.current.moved && drag.current.pointerId !== event.pointerId) drag.current = null
      if (pick.current && pick.current.pointerId !== event.pointerId) cancelPick()
      if (event.target !== domElement || !startsPick(event)) return
      pick.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        boxing: false,
        pressedId: null,
      }
      // Shift+drag would turn the camera; a finger in select mode is already left to the box by the controls.
      if (event.pointerType !== 'touch') setControlsEnabled(false)
    }
    const drawBox = (current: PickState, event: PointerEvent) => {
      current.boxing = true
      box.hidden = false
      box.style.left = `${Math.min(current.startX, event.clientX)}px`
      box.style.top = `${Math.min(current.startY, event.clientY)}px`
      box.style.width = `${Math.abs(event.clientX - current.startX)}px`
      box.style.height = `${Math.abs(event.clientY - current.startY)}px`
    }
    const movePick = (event: PointerEvent) => {
      const current = pick.current
      if (!current || event.pointerId !== current.pointerId) return
      const distance = Math.hypot(event.clientX - current.startX, event.clientY - current.startY)
      if (current.boxing || distance >= DRAG_THRESHOLD_PIXELS) drawBox(current, event)
    }
    const startMoving = (current: DragState) => {
      onGestureStart()
      current.selectOnDrag()
      setControlsEnabled(false)
      current.moved = true
    }
    const moveDrag = (event: PointerEvent) => {
      const current = drag.current
      if (!current || event.pointerId !== current.pointerId) return
      const distance = Math.hypot(event.clientX - current.startX, event.clientY - current.startY)
      if (!current.moved && distance < DRAG_THRESHOLD_PIXELS) return
      if (!current.moved) startMoving(current)
      const rect = domElement.getBoundingClientRect()
      pointer.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1,
      )
      raycaster.setFromCamera(pointer, camera)
      if (!raycaster.ray.intersectPlane(current.plane, hit)) return
      const point = hit.clone().sub(current.offset)
      // One React update per frame, however fast the pointer reports.
      pending = () => current.apply(point)
      frame ||= requestAnimationFrame(flush)
    }
    const move = (event: PointerEvent) => {
      movePick(event)
      moveDrag(event)
    }
    const endPick = (event: PointerEvent) => {
      const current = pick.current
      if (!current || current.pointerId !== event.pointerId) return
      cancelPick()
      // A cancelled pointer picks nothing.
      if (event.type === 'pointerup') finishPick(current, event.clientX, event.clientY)
    }
    const endDrag = (event: PointerEvent) => {
      const current = drag.current
      if (!current || current.pointerId !== event.pointerId) return
      drag.current = null
      setControlsEnabled(true)
      // A press let go without dragging selected what it pressed; a cancelled touch did not.
      if (!current.moved && event.type === 'pointerup') current.selectOnTap()
    }
    // A tap on the map can open the inspector under the finger before the browser sends that tap's click, which must
    // not press whatever control appeared there.
    let ghostClickUntil = 0
    const end = (event: PointerEvent) => {
      touches.current.delete(event.pointerId)
      if (event.pointerType === 'touch' && event.target === domElement) ghostClickUntil = event.timeStamp + 400
      endPick(event)
      endDrag(event)
    }
    const swallowGhostClick = (event: MouseEvent) => {
      if (event.timeStamp > ghostClickUntil || event.target === domElement) return
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('pointerdown', press, true)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    window.addEventListener('click', swallowGhostClick, true)
    return () => {
      cancelAnimationFrame(frame)
      box.remove()
      window.removeEventListener('pointerdown', press, true)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      window.removeEventListener('click', swallowGhostClick, true)
    }
  }, [camera, domElement, onGestureStart])

  /**
   * Drags along the horizontal plane at the anchor's height, so birds and clouds keep their altitude. A mouse selects
   * what it presses at once and holds the camera still. A finger leaves the camera free until it drags, and a second
   * finger makes the press a pinch or turn, so a camera gesture that starts on a marker neither selects nor moves it.
   * Pressing one of several selected objects keeps them all selected, so a drag moves them together.
   */
  const grab = (
    event: ThreeEvent<PointerEvent>,
    select: () => void,
    anchor: Vec3,
    apply: (point: Vector3) => void,
    keepsSelection = false,
  ) => {
    event.stopPropagation()
    // A Shift press or a press in select mode picks markers instead.
    if (pick.current?.pointerId === event.pointerId) return
    const touch = event.pointerType === 'touch'
    const selectsOnPress = !touch && !keepsSelection
    if (selectsOnPress) select()
    if (event.button !== 0 || touches.current.size > 1) return
    const plane = new Plane(new Vector3(0, 1, 0), -anchor.y)
    const anchorPoint = new Vector3(anchor.x, anchor.y, anchor.z)
    const grabbed = event.ray.intersectPlane(plane, new Vector3()) ?? anchorPoint.clone()
    drag.current = {
      pointerId: event.pointerId,
      startX: event.nativeEvent.clientX,
      startY: event.nativeEvent.clientY,
      moved: false,
      plane,
      offset: grabbed.sub(anchorPoint),
      apply,
      selectOnDrag: touch && !keepsSelection ? select : () => undefined,
      selectOnTap: selectsOnPress ? () => undefined : select,
    }
    if (!touch && controls.current) controls.current.enabled = false
  }

  const grabObject = (event: ThreeEvent<PointerEvent>, objects: TownObject[]) => {
    const object = event.instanceId === undefined ? undefined : objects[event.instanceId]
    if (!object) return
    const picking = pick.current
    if (picking?.pointerId === event.pointerId) {
      event.stopPropagation()
      picking.pressedId = object.id
      return
    }
    const group = getSelectedObjectIds(selection)
    const keepsSelection = group.length > 1 && group.includes(object.id)
    const origins = getObjectOrigins(town, keepsSelection ? group : [object.id])
    grab(
      event,
      () => onSelect({ kind: 'object', id: object.id }),
      object.position,
      (point) =>
        onEdit((current) =>
          moveObjects(current, origins, { x: point.x - object.position.x, z: point.z - object.position.z }),
        ),
      keepsSelection,
    )
  }

  // A Shift click or a tap in select mode adds and removes markers instead, and a longer press moved the camera.
  const clearSelection = (event: ThreeEvent<MouseEvent>) => {
    if (event.delta > DRAG_THRESHOLD_PIXELS || event.nativeEvent.shiftKey || selectMode) return
    onSelect(null)
  }

  return (
    <>
      <MapControls
        ref={controls}
        makeDefault
        screenSpacePanning={false}
        enableDamping
        {...viewControls[view]}
        touches={selectMode ? selectModeTouches : viewControls[view].touches}
        onStart={stopFocus}
      />
      <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} onClick={clearSelection}>
        <planeGeometry args={[400, 400]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {marking &&
        markerLayers.map((layer) => (
          <ObjectMarkers
            key={layer.key}
            objects={layer.objects}
            look={layer.look}
            ground={layer.ground}
            onGrab={grabObject}
          />
        ))}
      {marking && selectedObject?.type === 'road' && (
        <PointHandles
          points={getRoadWorldPoints(selectedObject)}
          selectedIndex={single?.pointIndex}
          color="#7b5b3a"
          onGrab={(event, index) => {
            const [x, z] = getRoadWorldPoints(selectedObject)[index]
            grab(
              event,
              () => onSelect({ kind: 'object', id: selectedObject.id, pointIndex: index }),
              { x, y: 0, z },
              (point) => onEdit((current) => moveRoadPoint(current, selectedObject.id, index, [point.x, point.z])),
            )
          }}
        />
      )}
      {marking && selectedResident && (
        <PointHandles
          points={getResidentWalk(town, selectedResident)}
          selectedIndex={single?.pointIndex}
          lockedIndex={selectedResident.seatIndex}
          closed={selectedResident.route.length > 2}
          color="#3f7fbf"
          onGrab={(event, index) => {
            const [x, z] = selectedResident.route[index]
            grab(
              event,
              () => onSelect({ kind: 'resident', id: selectedResident.id, pointIndex: index }),
              { x, y: 0, z },
              (point) => onEdit((current) => moveRoutePoint(current, selectedResident.id, index, [point.x, point.z])),
            )
          }}
        />
      )}
      {marking && petRoute && (
        <PointHandles
          points={petRoute}
          selectedIndex={single?.pointIndex}
          closed
          color="#c9753a"
          onGrab={(event, index) => {
            const [x, z] = petRoute[index]
            grab(
              event,
              () => onSelect({ ...PET_SELECTION, pointIndex: index }),
              { x, y: 0, z },
              (point) => onEdit((current) => movePetRoutePoint(current, index, [point.x, point.z])),
            )
          }}
        />
      )}
      {/* The ground a shown venue keeps for its own garden; objects placed in it move out to its edge. */}
      {marking &&
        venueApproaches.map((outline, index) => (
          <Line
            key={index}
            points={outline.map(([x, z]) => [x, 0.16, z] as const)}
            color={VENUE_APPROACH_COLOR}
            lineWidth={2.5}
            dashed
            dashSize={0.7}
            gapSize={0.45}
          />
        ))}
      {marking && blockedLegs.length > 0 && (
        <Line
          segments
          points={blockedLegs.flatMap(([[startX, startZ], [endX, endZ]]) => [
            [startX, 0.22, startZ] as const,
            [endX, 0.22, endZ] as const,
          ])}
          color={BLOCKED_LEG_COLOR}
          lineWidth={6}
        />
      )}
      {marking && benchStop && (
        <mesh position={[benchStop[0], 0.08, benchStop[1]]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={5}>
          <ringGeometry args={[0.55, 0.85, 24]} />
          <meshBasicMaterial color="#3f7fbf" transparent opacity={0.9} depthWrite={false} toneMapped={false} />
        </mesh>
      )}
    </>
  )
}

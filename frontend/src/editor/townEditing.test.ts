import { describe, expect, it } from 'vitest'
import { SAMPLE_TOWN } from '../testing/sampleTown'
import { getRoadWorldPoints } from '../scene/objects/roads/roadLayout'
import {
  addObject,
  addResident,
  addRoadPoint,
  canDraftDialogue,
  clampToTown,
  createEditorId,
  getEditorCameraPose,
  getBenchStop,
  getLayoutProblems,
  getMarkerPosition,
  getRemovalBlock,
  movePetRoutePoint,
  moveRoadPoint,
  moveRoutePoint,
  removeObject,
  removePetRoutePoint,
  removeRoadPoint,
  removeResident,
  removeRoutePoint,
  resetPetRoute,
  setResidentOwnership,
  startPetRoute,
  updateObject,
  updateResident,
} from './townEditing'

const sequence = (...values: number[]) => {
  let index = 0
  return () => values[index++ % values.length]
}
const find = (id: string, town = SAMPLE_TOWN) => town.objects.find((object) => object.id === id)!

describe('town editing', () => {
  it('moves one object and keeps every other object identical, so only it re-renders', () => {
    const moved = updateObject(SAMPLE_TOWN, 'house-maple', { position: { x: 12.345, y: 0, z: -80 } })
    expect(find('house-maple', moved).position).toEqual({ x: 12.3, y: 0, z: -52 })
    expect(moved.objects.filter((object, index) => object !== SAMPLE_TOWN.objects[index])).toHaveLength(1)
    expect(SAMPLE_TOWN.objects.find(({ id }) => id === 'house-maple')!.position.x).toBe(22)
  })

  it('keeps sky objects in the sky and birds inside their flight wrap', () => {
    expect(clampToTown('bird', { x: 120, y: 90, z: -3 })).toEqual({ x: 75, y: 40, z: -3 })
    expect(clampToTown('cloud', { x: 104, y: 0, z: 0 })).toEqual({ x: 104, y: 2, z: 0 })
    expect(clampToTown('tree', { x: 1, y: 0.5, z: 1 }).y).toBe(0.5)
  })

  it('adds objects with backend-valid ids and the defaults each type needs', () => {
    const at = { x: 3, y: 0, z: 4 }
    const house = addObject(SAMPLE_TOWN, 'house', at, 'Neighbor', sequence(0.5))
    expect(find(house.id, house.town)).toMatchObject({ type: 'house', ownerName: 'Neighbor', position: at })
    const road = addObject(SAMPLE_TOWN, 'road', at, 'Neighbor')
    expect(find(road.id, road.town)).toMatchObject({
      width: 4,
      points: [
        [-6, 0],
        [6, 0],
      ],
    })
    const bird = addObject(SAMPLE_TOWN, 'bird', at, 'Neighbor')
    expect(find(bird.id, bird.town).position.y).toBe(7)
    const dogHouse = addObject(SAMPLE_TOWN, 'dogHouse', at, 'Neighbor')
    expect(dogHouse.id).toMatch(/^dog-house-[a-z0-9]+$/u)
  })

  it('never reuses an existing id', () => {
    const repeated = sequence(0.1, 0.1, 0.9)
    const first = createEditorId('tree', new Set(), sequence(0.1))
    expect(createEditorId('tree', new Set([first]), repeated)).not.toBe(first)
  })

  it('protects the fountain, the guestbook board, and benches residents rest on', () => {
    expect(getRemovalBlock(SAMPLE_TOWN, 'fountain')).toBe('singleton')
    expect(getRemovalBlock(SAMPLE_TOWN, 'bench-north')).toBe('bench-in-use')
    expect(removeObject(SAMPLE_TOWN, 'guestbook')).toBe(SAMPLE_TOWN)
    expect(removeObject(SAMPLE_TOWN, 'tree-3').objects).toHaveLength(SAMPLE_TOWN.objects.length - 1)
    const moved = updateResident(SAMPLE_TOWN, 'maple', { benchId: 'bench-south' })
    expect(getRemovalBlock(moved, 'bench-north')).toBeNull()
  })

  it('edits road points in world space while storing them relative to the road', () => {
    const shifted = updateObject(SAMPLE_TOWN, 'road-north-south', { position: { x: 4, y: 0, z: 0 } })
    const reshaped = moveRoadPoint(shifted, 'road-north-south', 1, [10, -30])
    expect(getRoadWorldPoints(find('road-north-south', reshaped))[1]).toEqual([10, -30])
    expect(find('road-north-south', reshaped).points![1]).toEqual([6, -30])
    const extended = addRoadPoint(SAMPLE_TOWN, 'road-east-west')
    expect(find('road-east-west', extended).points).toHaveLength(8)
    const trimmed = removeRoadPoint(SAMPLE_TOWN, 'road-house-maple', 0)
    expect(find('road-house-maple', trimmed).points).toHaveLength(2)
    expect(removeRoadPoint(trimmed, 'road-house-maple', 0)).toEqual(trimmed)
  })

  it('grabs roads by their middle point', () => {
    const road = find('road-north-south')
    expect(getMarkerPosition(road)).toEqual({ x: 0, y: 0, z: 0 })
    expect(getMarkerPosition(find('house-pip'))).toBe(find('house-pip').position)
  })

  it('edits resident routes without ever dropping the bench stop', () => {
    const maple = SAMPLE_TOWN.residents.find(({ id }) => id === 'maple')!
    const moved = moveRoutePoint(SAMPLE_TOWN, 'maple', 0, [60, 1])
    expect(moved.residents.find(({ id }) => id === 'maple')!.route[0]).toEqual([52, 1])
    const withoutSeat = removeRoutePoint(SAMPLE_TOWN, 'maple', maple.seatIndex)
    expect(withoutSeat.residents.find(({ id }) => id === 'maple')!.route).toHaveLength(maple.route.length)
    const earlier = removeRoutePoint(SAMPLE_TOWN, 'maple', 0).residents.find(({ id }) => id === 'maple')!
    expect(earlier.seatIndex).toBe(maple.seatIndex - 1)
    expect(getBenchStop(SAMPLE_TOWN, maple)).toEqual([
      find('bench-north').position.x,
      expect.closeTo(find('bench-north').position.z + 1.35),
    ])
  })

  it('renames a resident everywhere their name is shown', () => {
    const renamed = updateResident(SAMPLE_TOWN, 'juno', { name: 'June' })
    const juno = renamed.residents.find(({ id }) => id === 'juno')!
    expect(juno.name).toBe('June')
    expect(juno.profile.name).toBe('June')
  })

  it('keeps one resident as the town owner, moving it between residents and clearing it when they leave', () => {
    const moved = setResidentOwnership(SAMPLE_TOWN, 'maple', true)
    expect(moved.owner.residentId).toBe('maple')
    expect(setResidentOwnership(moved, 'juno', false)).toBe(moved)
    expect(setResidentOwnership(moved, 'maple', false).owner.residentId).toBeNull()
    expect(removeResident(moved, 'juno').owner.residentId).toBe('maple')
    expect(removeResident(moved, 'maple').owner.residentId).toBeNull()
  })

  it('registers a resident on the nearest bench with a walkable loop', () => {
    const added = addResident(SAMPLE_TOWN, { x: 16, y: 0, z: 26 }, 'Neighbor', sequence(0.4))
    const resident = added.town.residents.find(({ id }) => id === added.id)!
    expect(resident).toMatchObject({ name: 'Neighbor', benchId: 'bench-garden', seatIndex: 0 })
    expect(resident.route).toHaveLength(3)
    expect(addResident({ ...SAMPLE_TOWN, objects: [] }, { x: 0, y: 0, z: 0 }, 'Nobody').id).toBeNull()
  })

  it('reports what the backend would reject before saving', () => {
    expect(getLayoutProblems(SAMPLE_TOWN)).toEqual([])
    const broken = updateObject(updateObject(SAMPLE_TOWN, 'house-juno', { ownerName: ' ' }), 'house-pip', {
      linkedInProfileUrl: 'https://example.com/in/pip',
    })
    const unnamed = updateResident(broken, 'pip', { name: '', linkedInProfileUrl: 'https://example.com/in/pip' })
    const unnamedPet = { ...unnamed, pet: { ...unnamed.pet, name: { ko: '토토', en: '' } } }
    expect(getLayoutProblems(unnamedPet)).toEqual([
      { id: 'mossbell', problem: 'town-names' },
      { id: 'house-juno', problem: 'owner-name' },
      { id: 'house-pip', problem: 'linkedin' },
      { id: 'pip', problem: 'resident-name' },
      { id: 'pip', problem: 'resident-linkedin' },
    ])
    const owner = { ...SAMPLE_TOWN.owner, introduction: { ko: '안녕하세요', en: ' ' }, contactEmail: 'robin@' }
    expect(getLayoutProblems({ ...SAMPLE_TOWN, owner })).toEqual([
      { id: 'mossbell', problem: 'owner-introduction' },
      { id: 'mossbell', problem: 'contact-email' },
    ])
    const cleared = { ...owner, introduction: { ko: '', en: '' }, contactEmail: ' ' }
    expect(getLayoutProblems({ ...SAMPLE_TOWN, owner: cleared })).toEqual([])
    const [question] = SAMPLE_TOWN.owner.questions
    const halfAnswered = [{ ...question, answer: { ko: question.answer.ko, en: ' ' } }]
    const ownerWithQuestions = { ...SAMPLE_TOWN.owner, residentId: 'juno', questions: halfAnswered }
    expect(getLayoutProblems({ ...SAMPLE_TOWN, owner: ownerWithQuestions })).toEqual([
      { id: 'juno', problem: 'owner-questions' },
    ])
  })

  it("starts the pet's walk from the default loop around the fountain and keeps it a saveable loop", () => {
    const started = startPetRoute(updateObject(SAMPLE_TOWN, 'fountain', { position: { x: 40, y: 0, z: 0 } }))
    const route = started.pet.route!
    expect(route[0]).toEqual([36, 0])
    expect(route.every(([x, z]) => Math.abs(x) <= 52 && Math.abs(z) <= 52)).toBe(true)
    expect(movePetRoutePoint(started, 1, [70, 3]).pet.route![1]).toEqual([52, 3])
    const triangle = { ...started, pet: { ...started.pet, route: route.slice(0, 3) } }
    expect(removePetRoutePoint(triangle, 0)).toBe(triangle)
    expect(resetPetRoute(started).pet.route).toBeNull()
  })

  it('drafts from the reference and requires every resident text in both languages before saving', () => {
    const maple = SAMPLE_TOWN.residents.find(({ id }) => id === 'maple')!
    expect(canDraftDialogue(maple)).toBe(true)
    expect(canDraftDialogue({ ...maple, reference: { ko: maple.reference.ko, en: ' ' } })).toBe(false)
    const halfWritten = updateResident(SAMPLE_TOWN, 'maple', { role: { ko: '제빵사', en: '' } })
    expect(getLayoutProblems(halfWritten)).toEqual([{ id: 'maple', problem: 'resident-texts' }])
    const blankLine = updateResident(SAMPLE_TOWN, 'maple', {
      dialogue: {
        aboutOwner: { ko: '좋아요', en: 'Great' },
        followUps: [{ question: { ko: '', en: '' }, answer: { ko: '네', en: 'Yes' } }],
      },
    })
    expect(getLayoutProblems(blankLine)).toEqual([{ id: 'maple', problem: 'resident-dialogue' }])
  })

  it('switches between the top view and visitor eye level without losing the spot or the heading', () => {
    const center = { x: 10, y: 0, z: -4 }
    const visitor = getEditorCameraPose('visitor', center, { x: 10, y: 42, z: 28 })
    expect(visitor.target).toEqual({ x: 10, y: 1.65, z: -4 })
    expect(visitor.position).toMatchObject({ x: 10, y: 1.7 })
    expect(visitor.position.z).toBeCloseTo(6.5)
    const turned = getEditorCameraPose('top', visitor.target, { x: 20.5, y: 1.7, z: -4 })
    expect(turned.target).toEqual({ x: 10, y: 0, z: -4 })
    expect(turned.position.x).toBeCloseTo(42)
    expect(turned.position).toMatchObject({ y: 42 })
    expect(turned.position.z).toBeCloseTo(-4)
  })
})

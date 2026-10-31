import { describe, expect, it } from 'vitest'
import {
  addToObjectSelection,
  getIdsInRectangle,
  getListRange,
  selectObjects,
  toggleObjectSelection,
} from './objectSelection'

describe('object selection', () => {
  it('selects the points inside a dragged rectangle, whichever way it was dragged', () => {
    const points = [
      { id: 'inside', x: 50, y: 50 },
      { id: 'edge', x: 100, y: 20 },
      { id: 'left', x: 9, y: 50 },
      { id: 'below', x: 50, y: 81 },
    ]
    expect(getIdsInRectangle(points, { x: 10, y: 20 }, { x: 100, y: 80 })).toEqual(['inside', 'edge'])
    expect(getIdsInRectangle(points, { x: 100, y: 80 }, { x: 10, y: 20 })).toEqual(['inside', 'edge'])
    expect(getIdsInRectangle(points, { x: 0, y: 0 }, { x: 5, y: 5 })).toEqual([])
  })

  it('toggles one object in and out, collapsing to a single object or nothing', () => {
    const one = toggleObjectSelection({ kind: 'resident', id: 'maple' }, 'tree-1')
    expect(one).toEqual({ kind: 'object', id: 'tree-1' })
    const two = toggleObjectSelection(one, 'tree-2')
    expect(two).toEqual({ kind: 'objects', ids: ['tree-1', 'tree-2'] })
    expect(toggleObjectSelection(two, 'tree-1')).toEqual({ kind: 'object', id: 'tree-2' })
    expect(toggleObjectSelection({ kind: 'object', id: 'tree-2' }, 'tree-2')).toBeNull()
    expect(addToObjectSelection(two, ['tree-2', 'tree-3'])).toEqual({
      kind: 'objects',
      ids: ['tree-1', 'tree-2', 'tree-3'],
    })
    expect(selectObjects([])).toBeNull()
  })

  it('selects a list range from the anchor either way, or only the row without an anchor in the list', () => {
    const list = ['a-1', 'a-2', 'a-3', 'a-4']
    expect(getListRange(list, 'a-1', 'a-3')).toEqual(['a-1', 'a-2', 'a-3'])
    expect(getListRange(list, 'a-4', 'a-2')).toEqual(['a-2', 'a-3', 'a-4'])
    expect(getListRange(list, 'b-1', 'a-2')).toEqual(['a-2'])
    expect(getListRange(list, null, 'a-2')).toEqual(['a-2'])
  })
})

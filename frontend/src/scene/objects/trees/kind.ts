import { roundPatchUnder } from '../../contactShadow'
import type { TownObjectKind } from '../townObjectKind'
import { TREE_VARIANTS } from '../variants'
import { getTreeColliders, getTreeLayout } from './treeLayout'
import { TreesLayer } from './TreesLayer'

export const treeKind: TownObjectKind = {
  category: 'nature',
  defaultColor: '#2ca35a',
  addable: true,
  singleton: false,
  markerRadius: 1,
  variants: TREE_VARIANTS,
  Layer: TreesLayer,
  colliders: (objects) => ({
    circles: getTreeColliders(objects).map(({ position, radius }) => ({ x: position[0], z: position[2], radius })),
  }),
  // Roots flare past the trunk, so a tree's patch is wider than its collider.
  contactShadows: (objects) => objects.map((tree) => roundPatchUnder(tree, getTreeLayout(tree).radius * 3)),
}

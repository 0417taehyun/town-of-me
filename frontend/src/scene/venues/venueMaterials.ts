import { useEffect, useLayoutEffect, useState } from 'react'
import { MeshStandardMaterial } from 'three'

// A venue's colors as materials shared by everything drawn in one role (walls, roof, ...), so an admin's color change
// recolors them in place: no geometry is rebuilt and no shader recompiles.

/** One material for each role a venue's palette colors. */
export type VenueMaterials<Role extends string> = Record<Role, MeshStandardMaterial>

export function createVenueMaterials<Role extends string>(palette: Readonly<Record<Role, string>>) {
  const roles = Object.keys(palette) as Role[]
  return Object.fromEntries(
    roles.map((role) => [role, new MeshStandardMaterial({ color: palette[role], roughness: 0.9 })]),
  ) as VenueMaterials<Role>
}

/** Recolors the same material instances, so every mesh drawn with them changes at once. */
export function applyVenuePalette<Role extends string>(
  materials: VenueMaterials<Role>,
  palette: Readonly<Record<Role, string>>,
) {
  const roles = Object.keys(palette) as Role[]
  roles.forEach((role) => materials[role].color.set(palette[role]))
}

/** The palette's materials, made once and recolored whenever the palette changes. */
export function useVenueMaterials<Role extends string>(palette: Readonly<Record<Role, string>>) {
  const [materials] = useState(() => createVenueMaterials(palette))
  useLayoutEffect(() => applyVenuePalette(materials, palette), [materials, palette])
  useEffect(
    () => () => (Object.values(materials) as MeshStandardMaterial[]).forEach((material) => material.dispose()),
    [materials],
  )
  return materials
}

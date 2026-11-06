import { readFile } from 'node:fs/promises'
import type { Store } from './store.js'
import { parseTownLayout } from './town.js'
import { inputRecord } from './validation.js'

/**
 * Gives a fresh store the town in `file`, so there is something to show and edit. A missing or invalid file only
 * logs why, so the server still starts.
 */
export async function seedTown(store: Store, file: string, logger: Pick<Console, 'log' | 'warn'>): Promise<void> {
  const seeded = await seedMissingTown(store, file).catch((error: unknown) => {
    logger.warn(`Town seed ${file} was not applied: ${error instanceof Error ? error.message : 'unknown error'}`)
    return false
  })
  if (seeded) logger.log(`Seeded the town from ${file}`)
}

/**
 * Stores the file's town (a layout, checked like a save) as revision 1 and returns `true`, or returns `false` without
 * touching anything when the store already holds a town. Seed files may carry other keys, such as an old `id`.
 */
export async function seedMissingTown(store: Store, file: string): Promise<boolean> {
  const layout = parseTownLayout(inputRecord(JSON.parse(await readFile(file, 'utf8')), 'seed'))
  if (await store.getTown()) return false
  await store.saveTown(layout, 0)
  return true
}

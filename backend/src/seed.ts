import { readFile } from 'node:fs/promises'
import type { Store } from './store.js'
import { parseTownLayout, townIdentifier } from './town.js'
import { inputRecord } from './validation.js'

/**
 * Gives a fresh store the town in `file`, so there is something to show and edit. A missing or invalid file only
 * logs why, so the server still starts.
 */
export async function seedTown(store: Store, file: string, logger: Pick<Console, 'log' | 'warn'>): Promise<void> {
  const seededId = await seedMissingTown(store, file).catch((error: unknown) => {
    logger.warn(`Town seed ${file} was not applied: ${error instanceof Error ? error.message : 'unknown error'}`)
    return null
  })
  if (seededId) logger.log(`Seeded town ${seededId} from ${file}`)
}

/**
 * Stores the file's town (a layout plus `id`, checked like a save) as revision 1 and returns its id, or returns
 * `null` without touching anything when a town with that id already exists.
 */
export async function seedMissingTown(store: Store, file: string): Promise<string | null> {
  const input = inputRecord(JSON.parse(await readFile(file, 'utf8')), 'seed')
  const id = townIdentifier(input.id, 'id')
  const layout = parseTownLayout(input)
  if (await store.getTown(id)) return null
  await store.saveTown(id, layout, 0)
  return id
}

// The fictional sample town for tests only: a copy of backend/seed/town.json, read through the same boundary as a
// saved town. Nothing in the app imports this, so it never reaches the production bundle.
import type { TownSnapshot } from '../data/models'
import { parseTownLayout } from '../data/townApi'
import layout from './sampleTown.json'

export const SAMPLE_TOWN: TownSnapshot = parseTownLayout({ ...layout, revision: 1 })

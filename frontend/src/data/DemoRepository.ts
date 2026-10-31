import type { DemoSession, TownSnapshot } from './models'

export interface DemoRepository {
  getTown(townId: string): Promise<TownSnapshot>
  getSession(townId: string): Promise<DemoSession | null>
  saveSession(session: DemoSession): Promise<void>
  resetSession(townId: string): Promise<void>
}

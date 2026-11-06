import type { DemoSession, TownSnapshot } from './models'

export interface DemoRepository {
  getTown(): Promise<TownSnapshot>
  getSession(): Promise<DemoSession | null>
  saveSession(session: DemoSession): Promise<void>
  resetSession(): Promise<void>
}

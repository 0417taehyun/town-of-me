import { requestJson, requireList, requireRecord, requireText, responseRecord } from './apiClient'

// The wire format of GET /v1/admin/stats (backend/src/siteStats.ts). Only the lazy usage statistics dialog imports this.

/** How many days the dialog reads: its trend's length. */
export const STATS_DAYS = 30

export type UsageStats = {
  range: { from: string; to: string }
  daily: { day: string; event: string; count: number }[]
  residents: { id: string; name: string | null; conversations: number }[]
  guestbook: { byStatus: { pending: number; approved: number }; byDay: { day: string; count: number }[] }
  derby: { week: string; runs: number; records: number }[]
}

export function requireCount(value: unknown, label: string) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) throw new Error(`${label} must be a count`)
  return value
}

export function parseUsageStats(input: Record<string, unknown>): UsageStats {
  const range = requireRecord(input.range, 'range')
  const guestbook = requireRecord(input.guestbook, 'guestbook')
  const byStatus = requireRecord(guestbook.byStatus, 'guestbook.byStatus')
  return {
    range: { from: requireText(range.from, 'range.from'), to: requireText(range.to, 'range.to') },
    daily: requireList(input.daily, 'daily').map((value) => {
      const row = requireRecord(value, 'daily row')
      return {
        day: requireText(row.day, 'daily day'),
        event: requireText(row.event, 'daily event'),
        count: requireCount(row.count, 'daily count'),
      }
    }),
    residents: requireList(input.residents, 'residents').map((value) => {
      const row = requireRecord(value, 'resident')
      return {
        id: requireText(row.id, 'resident id'),
        name: typeof row.name === 'string' ? row.name : null,
        conversations: requireCount(row.conversations, 'resident conversations'),
      }
    }),
    guestbook: {
      byStatus: {
        pending: requireCount(byStatus.pending, 'pending notes'),
        approved: requireCount(byStatus.approved, 'approved notes'),
      },
      byDay: requireList(guestbook.byDay, 'guestbook.byDay').map((value) => {
        const row = requireRecord(value, 'guestbook day')
        return { day: requireText(row.day, 'guestbook day'), count: requireCount(row.count, 'guestbook count') }
      }),
    },
    derby: requireList(input.derby, 'derby').map((value) => {
      const row = requireRecord(value, 'derby week')
      return {
        week: requireText(row.week, 'derby week'),
        runs: requireCount(row.runs, 'derby runs'),
        records: requireCount(row.records, 'derby records'),
      }
    }),
  }
}

export async function fetchUsageStats(): Promise<UsageStats> {
  const response = await requestJson(`/v1/admin/stats?days=${STATS_DAYS}`)
  if (!response.ok) throw new Error(`Usage statistics returned ${response.status}`)
  return parseUsageStats(await responseRecord(response))
}

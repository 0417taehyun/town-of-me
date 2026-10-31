export const locales = ['ko', 'en'] as const
export type Locale = (typeof locales)[number]
export type LocalizedText = Readonly<Record<Locale, string>>

export type Actor =
  | Readonly<{ kind: 'anonymous' }>
  | Readonly<{
      kind: 'linked'
      userId: string
      role: 'member' | 'admin'
    }>

export interface LinkedUser {
  id: string
  oidcIssuer: string
  oidcSubject: string
  displayName: string
  email: string | null
  pictureUrl: string | null
  role: 'member' | 'admin'
  createdAt: string
  deletedAt: string | null
}

export class DomainError extends Error {
  constructor(
    readonly code: 'AUTH_REQUIRED' | 'FORBIDDEN' | 'INVALID_INPUT' | 'NOT_CONFIGURED' | 'NOT_FOUND' | 'CONFLICT',
    message: string,
  ) {
    super(message)
    this.name = 'DomainError'
  }
}

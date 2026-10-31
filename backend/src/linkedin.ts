import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from 'jose'
import type { LinkedInOidcAdapter, VerifiedLinkedInIdentity } from './auth.js'
import { DomainError } from './domain.js'
import { isPlainObject } from './validation.js'

/** Stable issuer stored with users, independent of which advertised issuer a token carries. */
const issuer = 'https://www.linkedin.com'
// LinkedIn's discovery document advertises `/oauth`; both values are LinkedIn's own and tokens are still
// verified against LinkedIn's signing keys.
const acceptedIssuers = ['https://www.linkedin.com/oauth', issuer]
const authorizationEndpoint = 'https://www.linkedin.com/oauth/v2/authorization'
const tokenEndpoint = 'https://www.linkedin.com/oauth/v2/accessToken'
const linkedInKeys = createRemoteJWKSet(new URL('https://www.linkedin.com/oauth/openid/jwks'))
// The ID token comes straight from the code exchange, so an old one can only be a replayed token.
const idTokenMaximumAge = '10m'
// Tolerates small clock differences with LinkedIn, which would otherwise make a fresh token look issued in the future.
const clockToleranceSeconds = 60

export interface LinkedInOidcConfig {
  clientId: string
  clientSecret: string
  redirectUri: string
}

export interface LinkedInOidcDependencies {
  fetch: typeof fetch
  verifyIdToken(token: string, clientId: string): Promise<JWTPayload>
}

export async function verifyLinkedInIdToken(
  token: string,
  clientId: string,
  keys: JWTVerifyGetKey = linkedInKeys,
): Promise<JWTPayload> {
  const verified = await jwtVerify(token, keys, {
    algorithms: ['RS256'],
    audience: clientId,
    issuer: acceptedIssuers,
    maxTokenAge: idTokenMaximumAge,
    clockTolerance: clockToleranceSeconds,
  })
  return verified.payload
}

const defaultDependencies: LinkedInOidcDependencies = {
  fetch,
  verifyIdToken: (token, clientId) => verifyLinkedInIdToken(token, clientId),
}

export function createLinkedInOidcAdapter(
  config: LinkedInOidcConfig,
  dependencies: LinkedInOidcDependencies = defaultDependencies,
): LinkedInOidcAdapter {
  return {
    // LinkedIn reserves PKCE for native apps it enables individually; a web app sending code_challenge gets
    // `invalid_client` at token exchange, so this confidential client relies on its server-side secret instead.
    createAuthorizationUrl(input) {
      const url = new URL(authorizationEndpoint)
      url.search = new URLSearchParams({
        response_type: 'code',
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        state: input.state,
        nonce: input.nonce,
        scope: input.scopes.join(' '),
      }).toString()
      return url
    },

    async exchangeAndVerify(input) {
      const response = await dependencies.fetch(tokenEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: input.code,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: config.redirectUri,
        }),
      })
      if (!response.ok) {
        throw authenticationFailed(`token exchange returned ${response.status}${await providerErrorDetail(response)}`)
      }

      const token = await readIdToken(response)
      let payload: JWTPayload
      try {
        payload = await dependencies.verifyIdToken(token, config.clientId)
      } catch (error) {
        throw authenticationFailed(
          `ID token verification failed (${error instanceof Error ? error.message : 'unknown'})`,
        )
      }
      // LinkedIn does not echo the requested nonce; a nonce that is present must still match.
      if (payload.nonce !== undefined && payload.nonce !== input.expectedNonce) {
        throw authenticationFailed('ID token nonce did not match')
      }
      if (!payload.sub || typeof payload.name !== 'string') {
        throw authenticationFailed('ID token is missing sub or name')
      }
      return linkedInIdentity(payload)
    },
  }
}

export function createLinkedInOidcFromEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  defaultRedirectUri: string,
): LinkedInOidcAdapter | undefined {
  const clientId = environment.LINKED_IN_CLIENT_ID?.trim()
  const clientSecret = environment.LINKED_IN_CLIENT_SECRET?.trim()
  if (!clientId && !clientSecret) return undefined
  if (!clientId || !clientSecret) {
    throw new Error('LINKED_IN_CLIENT_ID and LINKED_IN_CLIENT_SECRET must be configured together')
  }
  return createLinkedInOidcAdapter({
    clientId,
    clientSecret,
    redirectUri: environment.LINKED_IN_REDIRECT_URI?.trim() || defaultRedirectUri,
  })
}

export async function readIdToken(response: Response): Promise<string> {
  const value: unknown = await response.json().catch(() => null)
  const token = isPlainObject(value) ? value.id_token : null
  if (typeof token !== 'string' || !token) throw authenticationFailed('token response has no id_token')
  return token
}

export function linkedInIdentity(payload: JWTPayload): VerifiedLinkedInIdentity {
  return {
    issuer,
    subject: payload.sub!,
    displayName: payload.name as string,
    email: typeof payload.email === 'string' ? payload.email : null,
    // LinkedIn documents a boolean, but some ID tokens carry the string "true".
    emailVerified: payload.email_verified === true || payload.email_verified === 'true',
    pictureUrl: typeof payload.picture === 'string' ? payload.picture : null,
  }
}

/** Reads LinkedIn's OAuth error fields for the server log; never includes request secrets. */
export async function providerErrorDetail(response: Response): Promise<string> {
  const value: unknown = await response.json().catch(() => null)
  if (!isPlainObject(value)) return ''
  const detail = [value.error, value.error_description].filter((field) => typeof field === 'string').join(': ')
  return detail ? ` ${JSON.stringify(detail.slice(0, 200))}` : ''
}

// The callback only logs these reasons server-side; the browser always receives a generic failure redirect.
export function authenticationFailed(reason: string): DomainError {
  return new DomainError('FORBIDDEN', `LinkedIn authentication failed: ${reason}`)
}

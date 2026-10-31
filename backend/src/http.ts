import {
  beginLinkedInLogin,
  completeLinkedInLogin,
  hashToken,
  oidcTransactionLifetimeMs,
  randomToken,
  sessionLifetimeMs,
  type AuthStore,
  type LinkedInOidcAdapter,
} from './auth.js'
import { DomainError, type Actor, type LinkedUser } from './domain.js'
import { ownGuestbookEntry, publicGuestbookEntry, reviewedGuestbookEntry } from './guestbook.js'
import { BackendService } from './service.js'
import { townIdPattern } from './town.js'
import { inputRecord, invalidInput } from './validation.js'

const sessionCookie = '__Host-tom_session'
const oauthCookie = '__Host-tom_oauth'
/** A random id for an anonymous guestbook writer's browser; only its hash is stored. */
const visitorCookie = '__Host-tom_visitor'
const visitorCookieLifetimeMs = 365 * 24 * 60 * 60_000
const cookieAttributes = 'Secure; HttpOnly; SameSite=Lax; Path=/'
// Only UUID-shaped ids reach the store, so malformed ids become 404 instead of database type errors.
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const readOnlyMethods = new Set(['GET', 'HEAD', 'OPTIONS'])
const domainErrorStatus: Readonly<Record<DomainError['code'], number>> = {
  AUTH_REQUIRED: 401,
  FORBIDDEN: 403,
  INVALID_INPUT: 400,
  NOT_CONFIGURED: 503,
  NOT_FOUND: 404,
  CONFLICT: 409,
}

type Logger = Pick<Console, 'warn' | 'error'>

export interface ApiDependencies {
  service: BackendService
  authStore: AuthStore
  linkedInOidc?: LinkedInOidcAdapter
  allowedOrigins: ReadonlySet<string>
  /** Where the LinkedIn callback sends the browser back; fixed by configuration to avoid open redirects. */
  frontendUrl: string
  logger?: Logger
}

/** What a route handler receives. */
export interface RouteContext {
  request: Request
  url: URL
  /** The id captured from the route path, or '' for a fixed path. */
  pathId: string
  /** Reads the session only for routes that act for someone, so sign-in and health checks never touch it. */
  actor(): Promise<Actor>
  dependencies: ApiDependencies & { logger: Logger }
}

export interface Route {
  method: string
  path: RegExp
  handle(context: RouteContext): Promise<Response> | Response
}

export function route(method: string, path: string, handle: Route['handle']): Route {
  return { method, path: new RegExp(`^${path}$`, 'u'), handle }
}

const routes: readonly Route[] = [
  route('GET', '/healthz', () => json({ ok: true })),
  route('GET', '/v1/auth/linkedin/start', serveLinkedInStart),
  route('GET', '/v1/auth/linkedin/callback', serveLinkedInCallback),
  route('POST', '/v1/auth/logout', serveLogout),
  route('GET', '/v1/me', async ({ actor, dependencies }) =>
    json({ user: currentUserView(await dependencies.service.getCurrentUser(await actor())) }),
  ),
  route('GET', '/v1/guestbook', serveGuestbook),
  route('POST', '/v1/guestbook', serveGuestbookSigning),
  route('PUT', `/v1/guestbook/(${uuid})`, async ({ request, pathId, dependencies }) => {
    const visitorHash = await readVisitorHash(request)
    const entry = await dependencies.service.reviseGuestbookEntry(visitorHash, pathId, await objectBody(request))
    return json({ entry: ownGuestbookEntry(entry, Date.now()) })
  }),
  route('GET', '/v1/admin/guestbook', async ({ actor, dependencies }) => {
    const entries = await dependencies.service.listGuestbookForReview(await actor())
    return json({ entries: entries.map(reviewedGuestbookEntry) })
  }),
  route('POST', `/v1/admin/guestbook/(${uuid})/approval`, async ({ request, pathId, actor, dependencies }) => {
    const { updatedAt } = await objectBody(request)
    const entry = await dependencies.service.approveGuestbookEntry(await actor(), pathId, updatedAt)
    return json({ entry: reviewedGuestbookEntry(entry) })
  }),
  route('DELETE', `/v1/admin/guestbook/(${uuid})`, async ({ pathId, actor, dependencies }) => {
    await dependencies.service.deleteGuestbookEntry(await actor(), pathId)
    return new Response(null, { status: 204 })
  }),
  route('GET', `/v1/towns/(${townIdPattern})`, async ({ pathId, dependencies }) =>
    json({ town: await dependencies.service.getTown(pathId) }),
  ),
  route('PUT', `/v1/admin/towns/(${townIdPattern})`, async ({ request, pathId, actor, dependencies }) =>
    json({ town: await dependencies.service.saveTown(await actor(), pathId, await objectBody(request)) }),
  ),
  route('POST', '/v1/admin/resident-dialogues', async ({ request, actor, dependencies }) =>
    json({ dialogue: await dependencies.service.draftResidentDialogue(await actor(), await objectBody(request)) }),
  ),
  route('GET', '/v1/admin/admins', async ({ actor, dependencies }) =>
    json(await dependencies.service.listAdmins(await actor())),
  ),
  route('POST', '/v1/admin/admins', async ({ request, actor, dependencies }) => {
    const { email } = await objectBody(request)
    return json({ admin: await dependencies.service.addAdmin(await actor(), email) }, 201)
  }),
  route('DELETE', '/v1/admin/admins/([^/]{1,800})', async ({ pathId, actor, dependencies }) => {
    await dependencies.service.removeAdmin(await actor(), decodeComponent(pathId))
    return new Response(null, { status: 204 })
  }),
]

export function createApi(dependencies: ApiDependencies): (request: Request) => Promise<Response> {
  const frontendOrigin = new URL(dependencies.frontendUrl).origin
  if (!dependencies.allowedOrigins.has(frontendOrigin)) {
    throw new Error(`FRONTEND_URL origin ${frontendOrigin} must be listed in ALLOWED_ORIGINS`)
  }
  const configured = { ...dependencies, logger: dependencies.logger ?? console }
  return (request) => dispatch(request, configured).catch((error: unknown) => errorResponse(error, configured.logger))
}

export async function dispatch(request: Request, dependencies: RouteContext['dependencies']): Promise<Response> {
  enforceOrigin(request, dependencies.allowedOrigins)
  const url = new URL(request.url)
  const matched = routes.find((candidate) => candidate.method === request.method && candidate.path.test(url.pathname))
  if (!matched) throw new DomainError('NOT_FOUND', 'Route not found')
  return matched.handle({
    request,
    url,
    pathId: url.pathname.match(matched.path)?.[1] ?? '',
    actor: () => resolveActor(request, dependencies.authStore),
    dependencies,
  })
}

/** Domain errors carry a message meant for the client; anything else is logged and stays generic. */
export function errorResponse(error: unknown, logger: Logger): Response {
  if (error instanceof DomainError) {
    return json({ error: { code: error.code, message: error.message } }, domainErrorStatus[error.code])
  }
  logger.error(error)
  return json({ error: { code: 'INTERNAL', message: 'Internal server error' } }, 500)
}

export async function serveLinkedInStart({ dependencies }: RouteContext): Promise<Response> {
  const started = await beginLinkedInLogin(dependencies.linkedInOidc, dependencies.authStore)
  return json({ authorizationUrl: started.authorizationUrl }, 200, {
    'Set-Cookie': cookie(oauthCookie, started.transactionId, oidcTransactionLifetimeMs),
  })
}

/** Every outcome returns the browser to the frontend; failure details stay in the server log. */
export async function serveLinkedInCallback({ request, url, dependencies }: RouteContext): Promise<Response> {
  const headers = new Headers({ 'Cache-Control': 'no-store' })
  headers.append('Set-Cookie', cookie(oauthCookie, '', 0))
  try {
    const result = await completeLinkedInLogin({
      adapter: dependencies.linkedInOidc,
      store: dependencies.authStore,
      ...callbackParameters(request, url),
    })
    headers.append('Set-Cookie', cookie(sessionCookie, result.sessionToken, sessionLifetimeMs))
    return redirect(loginResultUrl(dependencies.frontendUrl, 'success'), headers)
  } catch (error) {
    dependencies.logger.warn(`LinkedIn sign-in failed: ${error instanceof Error ? error.message : 'unknown error'}`)
    return redirect(loginResultUrl(dependencies.frontendUrl, 'failed'), headers)
  }
}

export async function serveLogout({ request, dependencies }: RouteContext): Promise<Response> {
  const token = readCookie(request, sessionCookie)
  if (token) await dependencies.authStore.deleteSession(await hashToken(token))
  return new Response(null, { status: 204, headers: { 'Set-Cookie': cookie(sessionCookie, '', 0) } })
}

export async function serveGuestbook({ request, dependencies }: RouteContext): Promise<Response> {
  const entries = await dependencies.service.listGuestbook()
  const own = await dependencies.service.getOwnGuestbookEntry(await readVisitorHash(request))
  return json({ entries: entries.map(publicGuestbookEntry), own: own && ownGuestbookEntry(own, Date.now()) })
}

export async function serveGuestbookSigning({ request, dependencies }: RouteContext): Promise<Response> {
  const existingToken = readCookie(request, visitorCookie)
  const visitorToken = existingToken || randomToken()
  const entry = await dependencies.service.signGuestbook(await hashToken(visitorToken), await objectBody(request))
  const headers = existingToken ? {} : { 'Set-Cookie': cookie(visitorCookie, visitorToken, visitorCookieLifetimeMs) }
  return json({ entry: ownGuestbookEntry(entry, Date.now()) }, 201, headers)
}

export function callbackParameters(request: Request, url: URL): { transactionId: string; state: string; code: string } {
  const providerError = url.searchParams.get('error')
  if (providerError) {
    throw new DomainError('FORBIDDEN', `LinkedIn returned ${JSON.stringify(providerError.slice(0, 100))}`)
  }
  const transactionId = readCookie(request, oauthCookie)
  const state = url.searchParams.get('state')
  const code = url.searchParams.get('code')
  if (!transactionId || !state || !code) throw invalidInput('OIDC callback parameters are missing')
  return { transactionId, state, code }
}

export function loginResultUrl(frontendUrl: string, result: 'success' | 'failed'): URL {
  const target = new URL(frontendUrl)
  target.searchParams.set('login', result)
  return target
}

export function redirect(location: URL, headers: Headers): Response {
  headers.set('Location', location.toString())
  return new Response(null, { status: 302, headers })
}

/** The signed-in user without their email or OIDC subject. */
export function currentUserView(user: LinkedUser | null) {
  return user && { id: user.id, displayName: user.displayName, pictureUrl: user.pictureUrl, role: user.role }
}

export async function resolveActor(request: Request, store: AuthStore): Promise<Actor> {
  const token = readCookie(request, sessionCookie)
  if (!token) return { kind: 'anonymous' }
  return (await store.resolveSession(await hashToken(token), Date.now())) ?? { kind: 'anonymous' }
}

/** `null` when this browser has no visitor cookie, so it owns no guestbook entry. */
export async function readVisitorHash(request: Request): Promise<string | null> {
  const token = readCookie(request, visitorCookie)
  return token ? hashToken(token) : null
}

/** Sessions live only in cookies, so every mutation must come from an allowed page to rule out cross-site forgery. */
export function enforceOrigin(request: Request, allowedOrigins: ReadonlySet<string>): void {
  if (readOnlyMethods.has(request.method)) return
  const origin = request.headers.get('Origin')
  if (!origin || !allowedOrigins.has(origin)) throw new DomainError('FORBIDDEN', 'Origin is not allowed')
}

export function readCookie(request: Request, name: string): string | null {
  const prefix = `${name}=`
  const pair = (request.headers.get('Cookie') ?? '')
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
  return pair === undefined ? null : decodeComponent(pair.slice(prefix.length))
}

/**
 * A malformed cookie or path value counts as missing, so broken percent-encoding cannot turn a request into a
 * server error.
 */
export function decodeComponent(value: string): string | null {
  try {
    return decodeURIComponent(value)
  } catch {
    return null
  }
}

export function cookie(name: string, value: string, lifetimeMs: number): string {
  return `${name}=${encodeURIComponent(value)}; ${cookieAttributes}; Max-Age=${Math.floor(lifetimeMs / 1000)}`
}

export async function objectBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
    throw invalidInput('Content-Type must be application/json')
  }
  const body: unknown = await request.json().catch(() => {
    throw invalidInput('The request body must be valid JSON')
  })
  return inputRecord(body, 'body')
}

/**
 * Every response is `no-store`: guestbook reads carry the visitor's own pending entry, a town save must show at
 * once, and session-bound answers must never be kept by a shared cache.
 */
export function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', ...headers } })
}

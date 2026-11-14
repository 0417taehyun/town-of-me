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
import { publicDerbyResult } from './homeRunDerby.js'
import {
  ownEntry,
  podiumEntry,
  rankedEntry,
  seasonView,
  statueCount,
  type GameRun,
  type RankedRecord,
} from './leaderboard.js'
import { reviewedEntry, reviewedRun, type EntryReviewAction } from './leaderboardReview.js'
import { BackendService, type Leaderboard, type RunOutcome, type SeasonStatues } from './service.js'
import { decodeComponent, inputRecord, invalidInput } from './validation.js'

const sessionCookie = '__Host-tom_session'
const oauthCookie = '__Host-tom_oauth'
/** A random id for an anonymous guestbook writer's browser; only its hash is stored. */
const visitorCookie = '__Host-tom_visitor'
const visitorCookieLifetimeMs = 365 * 24 * 60 * 60_000
const cookieAttributes = 'Secure; HttpOnly; SameSite=Lax; Path=/'
// Only UUID-shaped ids reach the store, so malformed ids become 404 instead of database type errors.
const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
// A ranked game's id; an unknown one is a 404 from the service.
const gameId = '[a-z][a-z0-9-]{0,31}'
/** A run's result is a few numbers per pitch, so game routes take a small body even without nginx in front. */
export const gameBodyLimitBytes = 8 * 1024
/** An event is a name and an id. */
export const siteEventBodyLimitBytes = 1024
const readOnlyMethods = new Set(['GET', 'HEAD', 'OPTIONS'])
/** What a browser's `fetch` to its own origin says of itself; the page never navigates to the API or embeds it. */
const pageFetchModes = new Set(['cors', 'same-origin'])
const domainErrorStatus: Readonly<Record<DomainError['code'], number>> = {
  AUTH_REQUIRED: 401,
  FORBIDDEN: 403,
  INVALID_INPUT: 400,
  NOT_CONFIGURED: 503,
  NOT_FOUND: 404,
  CONFLICT: 409,
  REQUEST_TOO_LARGE: 413,
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
  /** Every id captured from the route path, in order; `pathId` is the first. */
  pathIds: readonly string[]
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
  route('POST', '/v1/visitor/forget', serveVisitorForget),
  route('POST', '/v1/events', serveSiteEvent),
  route('GET', '/v1/admin/stats', async ({ url, actor, dependencies }) =>
    json(await dependencies.service.getSiteStats(await actor(), url.searchParams.get('days'))),
  ),
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
  route('POST', `/v1/games/(${gameId})/runs`, serveRunIssue),
  route('POST', `/v1/games/(${gameId})/runs/(${uuid})/result`, async ({ request, pathIds, dependencies }) => {
    const [game = '', runId = ''] = pathIds
    const body = await objectBody(request, gameBodyLimitBytes)
    const visitorHash = await readVisitorHash(request)
    const fromGamePage = looksLikePageFetch(request)
    const outcome = await dependencies.service.submitRunResult(game, visitorHash, runId, body, fromGamePage)
    return json(runOutcomeView(outcome))
  }),
  route('GET', `/v1/games/(${gameId})/leaderboard`, async ({ request, url, pathId, dependencies }) => {
    const visitorHash = await readVisitorHash(request)
    const season = url.searchParams.get('season')
    return json(leaderboardView(await dependencies.service.getLeaderboard(pathId, visitorHash, season)))
  }),
  route('GET', `/v1/games/(${gameId})/podium`, servePodium),
  route('GET', `/v1/games/(${gameId})/hall-of-fame`, async ({ pathId, dependencies }) =>
    json({ seasons: (await dependencies.service.getHallOfFame(pathId)).map(hallOfFameSeason) }),
  ),
  route('PUT', `/v1/games/(${gameId})/entries/own`, async ({ request, url, pathId, dependencies }) => {
    const body = await objectBody(request, gameBodyLimitBytes)
    const visitorHash = await readVisitorHash(request)
    const season = url.searchParams.get('season')
    const { entry, rank } = await dependencies.service.updateOwnEntry(pathId, visitorHash, body, season)
    return json({ entry: ownEntry(entry, rank) })
  }),
  route('DELETE', `/v1/games/(${gameId})/entries/own`, async ({ request, pathId, dependencies }) => {
    await dependencies.service.deleteOwnRecords(pathId, await readVisitorHash(request))
    return new Response(null, { status: 204 })
  }),
  route('POST', `/v1/games/(${gameId})/entries/(${uuid})/report`, async ({ request, pathIds, dependencies }) => {
    const [game = '', entryId = ''] = pathIds
    const body = await objectBody(request, gameBodyLimitBytes)
    await dependencies.service.reportEntry(game, await readVisitorHash(request), entryId, body)
    return new Response(null, { status: 204 })
  }),
  route('GET', `/v1/admin/games/(${gameId})/review`, async ({ url, pathId, actor, dependencies }) => {
    const season = url.searchParams.get('season')
    return json({ items: await dependencies.service.getReviewQueue(await actor(), pathId, season) })
  }),
  route('GET', `/v1/admin/games/(${gameId})/entries`, async ({ url, pathId, actor, dependencies }) => {
    const season = url.searchParams.get('season')
    return json(await dependencies.service.getBoardRecords(await actor(), pathId, season))
  }),
  route('GET', `/v1/admin/games/(${gameId})/entries/warnings`, async ({ url, pathId, actor, dependencies }) => {
    const season = url.searchParams.get('season')
    const ids = url.searchParams.get('ids') ?? ''
    return json({ warnings: await dependencies.service.getRecordWarnings(await actor(), pathId, season, ids) })
  }),
  route('GET', `/v1/admin/games/(${gameId})/runs/(${uuid})`, async ({ pathIds, actor, dependencies }) => {
    const [game = '', runId = ''] = pathIds
    return json({ run: reviewedRun(await dependencies.service.getReviewedRun(await actor(), game, runId), null) })
  }),
  entryReviewRoute('POST', 'approval', 'approval'),
  entryReviewRoute('POST', 'disqualification', 'disqualification'),
  entryReviewRoute('DELETE', 'disqualification', 'restoration'),
  entryReviewRoute('POST', 'linkedin-review', 'linkedin-review'),
  entryReviewRoute('POST', 'report-resolution', 'report-resolution'),
  entryReviewRoute('POST', 'appearance', 'appearance'),
  entryReviewRoute('POST', 'takedown', 'takedown'),
  route(
    'POST',
    `/v1/admin/games/(${gameId})/runs/(${uuid})/acceptance`,
    async ({ request, pathIds, actor, dependencies }) => {
      const [game = '', runId = ''] = pathIds
      const body = await objectBody(request)
      const { run, entry } = await dependencies.service.acceptHeldRun(await actor(), game, runId, body)
      return json({ run: reviewedRun(run, null), entry: reviewedEntry(entry, null) })
    },
  ),
  route('POST', `/v1/admin/games/(${gameId})/runs/(${uuid})/rejection`, async ({ pathIds, actor, dependencies }) => {
    const [game = '', runId = ''] = pathIds
    return json({ run: reviewedRun(await dependencies.service.rejectHeldRun(await actor(), game, runId), null) })
  }),
  route('POST', `/v1/admin/games/(${gameId})/runs/rejection`, async ({ request, pathId, actor, dependencies }) =>
    json(await dependencies.service.rejectListedRuns(await actor(), pathId, await objectBody(request))),
  ),
  route('GET', '/v1/town', async ({ dependencies }) => json({ town: await dependencies.service.getTown() })),
  route('PUT', '/v1/admin/town', async ({ request, actor, dependencies }) =>
    json({ town: await dependencies.service.saveTown(await actor(), await objectBody(request)) }),
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

/** An admin's action on a record answers with the record as the review queue shows it. */
export function entryReviewRoute(method: string, path: string, action: EntryReviewAction): Route {
  const entryPath = `/v1/admin/games/(${gameId})/entries/(${uuid})/${path}`
  return route(method, entryPath, async ({ request, pathIds, actor, dependencies }) => {
    const [game = '', entryId = ''] = pathIds
    const reviewer = await actor()
    const { entry, rank } = await dependencies.service.reviewEntry(
      reviewer,
      game,
      entryId,
      action,
      await objectBody(request),
    )
    return json({ entry: reviewedEntry(entry, rank) })
  })
}

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
  const pathIds = url.pathname.match(matched.path)?.slice(1) ?? []
  return matched.handle({
    request,
    url,
    pathId: pathIds[0] ?? '',
    pathIds,
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
  return json({ entry: ownGuestbookEntry(entry, Date.now()) }, 201, newVisitorCookie(existingToken, visitorToken))
}

/**
 * Lets the next person on a shared device start fresh. Only the cookie's hash ties a browser to what it wrote, so the
 * records and guestbook entries stay as they are and can no longer be changed from here.
 */
export function serveVisitorForget(): Response {
  return new Response(null, { status: 204, headers: { 'Set-Cookie': cookie(visitorCookie, '', 0) } })
}

/**
 * Adds to an anonymous daily total and answers the same whatever happened, so the response never says whether anything
 * was counted; a failure is only logged. It reads and sets no cookie, on purpose: nothing may tie a count to a browser.
 */
export async function serveSiteEvent({ request, dependencies }: RouteContext): Promise<Response> {
  const body = await objectBody(request, siteEventBodyLimitBytes).catch(() => null)
  await dependencies.service.recordSiteEvent(body).catch((error: unknown) => dependencies.logger.error(error))
  return new Response(null, { status: 204 })
}

/** The run's id, its season, and the rules and seed its pitches are planned from: all a client needs to play it. */
export async function serveRunIssue({ request, pathId, dependencies }: RouteContext): Promise<Response> {
  const existingToken = readCookie(request, visitorCookie)
  const visitorToken = existingToken || randomToken()
  const run = await dependencies.service.issueRun(pathId, await hashToken(visitorToken))
  return json({ run: issuedRunView(run) }, 201, newVisitorCookie(existingToken, visitorToken))
}

/**
 * Whether the request carries what every current browser adds to a page's `fetch` to its own origin, and a script does
 * not unless it is told to: `Sec-Fetch-Site: same-origin` and a fetch mode. The API is only ever served from the page's
 * origin (frontend/src/data/apiClient.ts). Only the yes or no leaves this function; the headers are not kept.
 */
export function looksLikePageFetch(request: Request): boolean {
  return (
    request.headers.get('Sec-Fetch-Site') === 'same-origin' &&
    pageFetchModes.has(request.headers.get('Sec-Fetch-Mode') ?? '')
  )
}

/** Sets the visitor cookie the first time a browser writes something it may later change. */
export function newVisitorCookie(existingToken: string | null, visitorToken: string): Record<string, string> {
  return existingToken ? {} : { 'Set-Cookie': cookie(visitorCookie, visitorToken, visitorCookieLifetimeMs) }
}

export function issuedRunView(run: GameRun) {
  return { id: run.id, season: run.season, expiresAt: run.expiresAt, rules: run.rules, seed: run.seed }
}

/**
 * The town's statues, each with the place it holds; a place whose record waits for approval is missing. No cookie is
 * read or set and nothing in it belongs to one visitor, so shared caches may keep it for a minute; an approval or a
 * disqualification shows within that.
 */
export async function servePodium({ pathId, dependencies }: RouteContext): Promise<Response> {
  const { season, entries } = await dependencies.service.getPodium(pathId)
  return json({ season: { id: season }, podium: entries.map(statueView) }, 200, {
    'Cache-Control': 'public, max-age=60',
  })
}

export function statueView({ entry, rank }: RankedRecord) {
  return podiumEntry(entry, rank)
}

/** A finished season's statues, each with its approved link while its owner keeps it on. */
export function hallOfFameSeason({ season, entries }: SeasonStatues) {
  return { id: season, champions: entries.map(statueView) }
}

/**
 * The first three places are the statues, which alone carry an approved link, and the rest the list below them. Each
 * record says its own place, since a statue's place waiting for approval is left out and stays empty.
 */
export function leaderboardView({ season, currentSeason, entries, own }: Leaderboard) {
  return {
    season: seasonView(season, currentSeason),
    podium: entries.filter(({ rank }) => rank <= statueCount).map(statueView),
    ranks: entries.filter(({ rank }) => rank > statueCount).map(({ entry, rank }) => rankedEntry(entry, rank)),
    own: own && ownEntry(own.entry, own.rank),
  }
}

/** The server's own result, never the client's totals, with the visitor's record and standing. */
export function runOutcomeView({ run, entry, rank, standing }: RunOutcome) {
  if (!run.result) throw new Error('A recorded run keeps its result')
  return { result: publicDerbyResult(run.result), standing, entry: entry && ownEntry(entry, rank) }
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

export function cookie(name: string, value: string, lifetimeMs: number): string {
  return `${name}=${encodeURIComponent(value)}; ${cookieAttributes}; Max-Age=${Math.floor(lifetimeMs / 1000)}`
}

/** `maximumBytes` bounds the raw body, so an oversized one is refused before it is parsed. */
export async function objectBody(
  request: Request,
  maximumBytes = Number.POSITIVE_INFINITY,
): Promise<Record<string, unknown>> {
  if (!request.headers.get('Content-Type')?.toLowerCase().startsWith('application/json')) {
    throw invalidInput('Content-Type must be application/json')
  }
  const bytes = await request.arrayBuffer()
  if (bytes.byteLength > maximumBytes) {
    throw new DomainError('REQUEST_TOO_LARGE', `The request body must be at most ${maximumBytes} bytes`)
  }
  return inputRecord(parseJson(new TextDecoder().decode(bytes)), 'body')
}

export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw invalidInput('The request body must be valid JSON')
  }
}

/**
 * Every response is `no-store` unless its route says otherwise (only the podium does): guestbook and leaderboard reads
 * carry the visitor's own entry, a town save must show at once, and session-bound answers must never be kept by a
 * shared cache.
 */
export function json(value: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(value, { status, headers: { 'Cache-Control': 'no-store', ...headers } })
}

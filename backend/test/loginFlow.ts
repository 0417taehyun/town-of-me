import {
  BackendService,
  createApi,
  MemoryStore,
  parseEmailList,
  type LinkedInOidcAdapter,
  type VerifiedLinkedInIdentity,
} from '../src/index.js'

type Assert = (condition: unknown, message: string) => asserts condition

const origin = 'https://town.example'

/** Drives the browser login round trip through the HTTP layer with a fake LinkedIn provider. */
export async function checkLoginFlow(assert: Assert): Promise<void> {
  const store = new MemoryStore()
  await store.seedAdminEmails(parseEmailList('owner@example.com, other@example.com'))
  const warnings: string[] = []
  let identity: VerifiedLinkedInIdentity = {
    issuer: 'https://www.linkedin.com',
    subject: 'owner-subject',
    displayName: 'Town Owner',
    email: ' Owner@Example.com ',
    emailVerified: true,
    pictureUrl: null,
  }
  const linkedInOidc: LinkedInOidcAdapter = {
    createAuthorizationUrl: (input) => new URL(`https://www.linkedin.com/oauth/v2/authorization?state=${input.state}`),
    exchangeAndVerify: async () => identity,
  }
  const dependencies = {
    service: new BackendService(store),
    authStore: store,
    linkedInOidc,
    allowedOrigins: new Set([origin]),
    frontendUrl: `${origin}/town`,
    logger: { warn: (message: string) => void warnings.push(message), error: console.error },
  }
  const api = createApi(dependencies)

  let rejectedFrontend = false
  try {
    createApi({ ...dependencies, frontendUrl: 'https://elsewhere.example/' })
  } catch {
    rejectedFrontend = true
  }
  assert(rejectedFrontend, 'a frontend URL outside the allowed origins must fail at startup')

  async function signIn(): Promise<Response> {
    const started = await api(new Request(`${origin}/v1/auth/linkedin/start`))
    const { authorizationUrl } = (await started.json()) as { authorizationUrl: string }
    const state = new URL(authorizationUrl).searchParams.get('state') ?? ''
    return api(
      new Request(`${origin}/v1/auth/linkedin/callback?state=${state}&code=code`, {
        headers: { Cookie: cookiePair(started, '__Host-tom_oauth') },
      }),
    )
  }

  async function currentUser(sessionCookie: string): Promise<Record<string, unknown> | null> {
    const response = await api(new Request(`${origin}/v1/me`, { headers: { Cookie: sessionCookie } }))
    return ((await response.json()) as { user: Record<string, unknown> | null }).user
  }

  const ownerLogin = await signIn()
  assert(ownerLogin.headers.get('Location') === `${origin}/town?login=success`, 'success must return to the frontend')
  assert(clearsCookie(ownerLogin, '__Host-tom_oauth'), 'callback must clear the one-use OAuth cookie')
  const ownerSession = cookiePair(ownerLogin, '__Host-tom_session')
  const owner = await currentUser(ownerSession)
  assert(owner?.role === 'admin', 'a configured admin must sign in as admin')
  const again = await currentUser(cookiePair(await signIn(), '__Host-tom_session'))
  assert(again?.role === 'admin' && again.id === owner.id, 'signing in again keeps the same admin user')

  identity = { ...identity, subject: 'unverified-subject', emailVerified: false }
  const memberSession = cookiePair(await signIn(), '__Host-tom_session')
  const unverified = await currentUser(memberSession)
  assert(unverified?.role === 'member', 'an unverified admin email must not grant admin')

  identity = { ...identity, subject: 'other-subject', email: 'other@example.com', emailVerified: true }
  const otherAdminSession = cookiePair(await signIn(), '__Host-tom_session')
  function admins(method: string, path: string, cookie: string, body?: unknown): Promise<Response> {
    return api(
      new Request(`${origin}/v1/admin/admins${path}`, {
        method,
        headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
        body: body === undefined ? null : JSON.stringify(body),
      }),
    )
  }
  assert((await admins('GET', '', memberSession)).status === 403, 'members cannot see the admin list')
  const added = await admins('POST', '', ownerSession, { email: ' New@Example.com ' })
  assert(
    added.status === 201 && ((await added.json()) as { admin: { email: string } }).admin.email === 'new@example.com',
    'an admin adds an email, kept trimmed and lowercase',
  )
  assert(
    (await admins('POST', '', ownerSession, { email: 'not an email' })).status === 400,
    'an invalid email is rejected',
  )
  assert(
    (await admins('DELETE', '/owner%40example.com', ownerSession)).status === 409,
    'an admin cannot remove their own email',
  )
  assert((await admins('DELETE', '/other@example.com', ownerSession)).status === 204, 'an admin removes another email')
  const listed = (await (await admins('GET', '', ownerSession)).json()) as {
    admins: Array<{ email: string }>
    currentEmail: string | null
  }
  assert(listed.currentEmail === 'owner@example.com', "the list names the signed-in admin's own email")
  assert(
    listed.admins.map(({ email }) => email).join() === 'new@example.com,owner@example.com' &&
      (await currentUser(otherAdminSession)) === null,
    'a removed admin leaves the list and is signed out at once',
  )

  identity = { ...identity, subject: 'owner-subject', email: 'changed@example.com' }
  const changedEmail = await currentUser(cookiePair(await signIn(), '__Host-tom_session'))
  assert(
    changedEmail?.role === 'member' && changedEmail.id === owner.id,
    'an admin whose email is no longer listed signs in as a member',
  )

  const providerError = await api(
    new Request(`${origin}/v1/auth/linkedin/callback?error=invalid_scope_error&state=state`, {
      headers: { Cookie: '__Host-tom_oauth=transaction' },
    }),
  )
  assert(providerError.headers.get('Location') === `${origin}/town?login=failed`, 'failure must return to the frontend')
  assert(
    warnings.some((warning) => warning.includes('invalid_scope_error')),
    'the provider error must be logged for debugging',
  )

  const logout = await api(
    new Request(`${origin}/v1/auth/logout`, { method: 'POST', headers: { Origin: origin, Cookie: ownerSession } }),
  )
  assert(logout.status === 204 && clearsCookie(logout, '__Host-tom_session'), 'logout must clear the session cookie')
  assert((await currentUser(ownerSession)) === null, 'a logged-out session must no longer identify the user')
  assert((await currentUser('')) === null, 'anonymous visitors have no current user')
}

function cookiePair(response: Response, name: string): string {
  const header = response.headers.getSetCookie().find((value) => value.startsWith(`${name}=`))
  return header?.split(';')[0] ?? ''
}

function clearsCookie(response: Response, name: string): boolean {
  return response.headers.getSetCookie().some((value) => value.startsWith(`${name}=;`) && value.includes('Max-Age=0'))
}

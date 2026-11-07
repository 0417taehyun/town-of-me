import {
  BackendService,
  createApi,
  createLinkedInOidcAdapter,
  createOpenRouterDialogueGenerator,
  DomainError,
  MemoryStore,
  verifyLinkedInIdToken,
} from '../src/index.js'
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose'
import { checkDerbyJudge } from './derbyJudge.js'
import { checkGuestbookFlow } from './guestbookFlow.js'
import { checkLeaderboardFlow } from './leaderboardFlow.js'
import { checkLeaderboardReviewFlow } from './leaderboardReviewFlow.js'
import { checkLoginFlow } from './loginFlow.js'
import { checkSiteStatsFlow } from './siteStatsFlow.js'
import { checkPostgresStoreContract, checkStoreContract } from './storeContract.js'
import { checkTownFlow } from './townFlow.js'

let assertions = 0

function assert(condition: unknown, message: string): asserts condition {
  assertions += 1
  if (!condition) throw new Error(message)
}

const store = new MemoryStore()
const api = createApi({
  service: new BackendService(store),
  authStore: store,
  allowedOrigins: new Set(['https://town.example']),
  frontendUrl: 'https://town.example/',
})
const unavailableLogin = await api(new Request('https://api.example/v1/auth/linkedin/start'))
assert(unavailableLogin.status === 503, 'missing OIDC adapter must fail explicitly')

const linkedIn = createLinkedInOidcAdapter(
  {
    clientId: 'client-id',
    clientSecret: 'client-secret',
    redirectUri: 'https://town.example/v1/auth/linkedin/callback',
  },
  {
    fetch: async (_input, init) => {
      const body = init?.body
      assert(
        body instanceof URLSearchParams && body.get('client_secret') === 'client-secret',
        'token exchange must authenticate the client',
      )
      return Response.json({ id_token: 'signed-token' })
    },
    verifyIdToken: async (token, audience) => {
      assert(
        token === 'signed-token' && audience === 'client-id',
        'the returned ID token is verified for the configured client',
      )
      return {
        iss: 'https://www.linkedin.com',
        sub: 'linkedin-subject',
        name: 'Linked Member',
        nonce: 'nonce',
        email: 'member@example.com',
        email_verified: 'true',
      }
    },
  },
)
const authorizationUrl = linkedIn.createAuthorizationUrl({
  state: 'state',
  nonce: 'nonce',
  scopes: ['openid', 'profile', 'email'],
})
assert(!authorizationUrl.searchParams.has('code_challenge'), 'LinkedIn web authorization must not request PKCE')
const verifiedIdentity = await linkedIn.exchangeAndVerify({
  code: 'authorization-code',
  expectedNonce: 'nonce',
})
assert(verifiedIdentity.subject === 'linkedin-subject', 'verified identity must use the ID token subject')
assert(verifiedIdentity.emailVerified, 'a string "true" email_verified claim must count as verified')

const signingKeys = await generateKeyPair('RS256')
const localLinkedInKeys = createLocalJWKSet({ keys: [{ ...(await exportJWK(signingKeys.publicKey)), alg: 'RS256' }] })
function signedIdToken(issuer: string, issuedAt?: number): Promise<string> {
  return new SignJWT({ nonce: 'nonce', name: 'Linked Member' })
    .setProtectedHeader({ alg: 'RS256' })
    .setIssuer(issuer)
    .setAudience('client-id')
    .setSubject('linkedin-subject')
    .setIssuedAt(issuedAt)
    .setExpirationTime('5m')
    .sign(signingKeys.privateKey)
}
const discoveryIssuerPayload = await verifyLinkedInIdToken(
  await signedIdToken('https://www.linkedin.com/oauth'),
  'client-id',
  localLinkedInKeys,
)
assert(discoveryIssuerPayload.sub === 'linkedin-subject', 'the issuer advertised by LinkedIn discovery must verify')
const foreignIssuer = await verifyLinkedInIdToken(
  await signedIdToken('https://issuer.example'),
  'client-id',
  localLinkedInKeys,
).then(
  () => null,
  (error: unknown) => error,
)
assert(foreignIssuer !== null, 'an ID token from another issuer must be rejected')
const replayedToken = await verifyLinkedInIdToken(
  await signedIdToken('https://www.linkedin.com', Math.floor(Date.now() / 1000) - 60 * 60),
  'client-id',
  localLinkedInKeys,
).then(
  () => null,
  (error: unknown) => error,
)
assert(replayedToken !== null, 'an ID token issued long ago must be rejected even before it expires')

const rejectingLinkedIn = createLinkedInOidcAdapter(
  {
    clientId: 'client-id',
    clientSecret: 'client-secret',
    redirectUri: 'https://town.example/v1/auth/linkedin/callback',
  },
  {
    fetch: async () =>
      Response.json(
        { error: 'invalid_request', error_description: 'Unable to retrieve access token' },
        { status: 400 },
      ),
    verifyIdToken: async () => ({}),
  },
)
const exchangeFailure = await rejectingLinkedIn
  .exchangeAndVerify({ code: 'authorization-code', expectedNonce: 'nonce' })
  .then(
    () => null,
    (error: unknown) => error,
  )
assert(
  exchangeFailure instanceof DomainError &&
    exchangeFailure.message.includes('invalid_request') &&
    !exchangeFailure.message.includes('client-secret'),
  'token exchange failures must keep the provider reason for logs without secrets',
)

function linkedInReturning(payload: Record<string, unknown>) {
  return createLinkedInOidcAdapter(
    {
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'https://town.example/v1/auth/linkedin/callback',
    },
    { fetch: async () => Response.json({ id_token: 'signed-token' }), verifyIdToken: async () => payload },
  )
}
const exchange = { code: 'authorization-code', expectedNonce: 'nonce' }
const withoutNonce = await linkedInReturning({ sub: 'linkedin-subject', name: 'Linked Member' }).exchangeAndVerify(
  exchange,
)
assert(withoutNonce.subject === 'linkedin-subject', 'LinkedIn ID tokens without a nonce must still sign in')
const wrongNonce = await linkedInReturning({ sub: 'linkedin-subject', name: 'Linked Member', nonce: 'other' })
  .exchangeAndVerify(exchange)
  .then(
    () => null,
    (error: unknown) => error,
  )
assert(wrongNonce instanceof DomainError, 'an ID token carrying a different nonce must be rejected')

const draftedLines = {
  aboutOwner: { ko: '로빈은 먼저 작게 만들어 보는 사람이에요.', en: 'Robin builds a small version first.' },
  followUps: [1, 2, 3, 4].map((number) => ({
    question: { ko: `질문 ${number}`, en: `Question ${number}` },
    answer: { ko: `답 ${number}`, en: `Answer ${number}` },
  })),
}
let openRouterRequest: RequestInit | undefined
function openRouterReturning(content: unknown, status = 200): typeof fetch {
  return async (_input, init) => {
    openRouterRequest = init
    return Response.json({ choices: [{ message: { content: JSON.stringify(content) } }] }, { status })
  }
}
const dialogueSource = {
  name: 'Maple',
  reference: { ko: '늘 먼저 시제품을 만들어요.', en: 'Always prototypes first.' },
  role: { ko: '빵집 제빵사', en: 'Baker at the corner bakery' },
  relationship: null,
  owner: { ko: '로빈', en: 'Robin' },
}
const openRouterConfig = { apiKey: 'openrouter-secret', model: 'openrouter/auto', siteName: 'Town of Me' }
const drafted = await createOpenRouterDialogueGenerator(
  openRouterConfig,
  openRouterReturning(draftedLines),
)(dialogueSource)
assert(
  drafted.aboutOwner.en === draftedLines.aboutOwner.en && drafted.followUps.length === 3,
  'drafted dialogue keeps its lines and drops follow-up questions past the limit',
)
assert(
  !String(openRouterRequest?.body).includes('openrouter-secret') &&
    String(openRouterRequest?.body).includes('Always prototypes first') &&
    String(openRouterRequest?.body).includes('Robin'),
  "the prompt carries the resident texts and the owner's name but never the OpenRouter secret",
)
for (const [label, generator] of [
  ['an empty line', openRouterReturning({ ...draftedLines, aboutOwner: { ko: ' ', en: 'Hi' } })],
  ['a missing language', openRouterReturning({ ...draftedLines, aboutOwner: { ko: '안녕하세요' } })],
  ['text that is not JSON', async () => Response.json({ choices: [{ message: { content: 'Sure!' } }] })],
  ['a provider error', openRouterReturning(draftedLines, 401)],
] as const) {
  const failure = await createOpenRouterDialogueGenerator(
    openRouterConfig,
    generator,
  )(dialogueSource).then(
    () => null,
    (error: unknown) => error,
  )
  assert(
    failure instanceof DomainError && failure.code === 'NOT_CONFIGURED',
    `${label} from OpenRouter must surface as an unavailable draft`,
  )
}
const unknownModel = await createOpenRouterDialogueGenerator(openRouterConfig, async () =>
  Response.json({ error: { message: 'openai/gpt-6.1-luna is not a valid model ID', code: 400 } }, { status: 400 }),
)(dialogueSource).then(
  () => null,
  (error: unknown) => error,
)
assert(
  unknownModel instanceof DomainError && unknownModel.message.includes('is not a valid model ID'),
  "a refused request shows OpenRouter's reason, such as an unknown model",
)
const exhausted = await createOpenRouterDialogueGenerator(openRouterConfig, async () =>
  Response.json({ model: 'z-ai/glm-5.3-flash', choices: [{ message: { content: null }, finish_reason: 'length' }] }),
)(dialogueSource).then(
  () => null,
  (error: unknown) => error,
)
assert(
  exhausted instanceof DomainError &&
    exhausted.message.includes('z-ai/glm-5.3-flash') &&
    exhausted.message.includes('length'),
  'a model that runs out of tokens before writing is named with its finish reason',
)

const malformedEntryResponse = await api(
  new Request('https://api.example/v1/guestbook/not-a-uuid', {
    method: 'PUT',
    headers: { Origin: 'https://town.example', 'Content-Type': 'application/json', Cookie: '__Host-tom_visitor=v' },
    body: JSON.stringify({ message: 'Hi', locale: 'en' }),
  }),
)
assert(malformedEntryResponse.status === 404, 'malformed guestbook entry ids must not reach the store')
const malformedJson = await api(
  new Request('https://api.example/v1/guestbook', {
    method: 'POST',
    headers: { Origin: 'https://town.example', 'Content-Type': 'application/json' },
    body: '{"message":',
  }),
)
assert(malformedJson.status === 400, 'a body that is not JSON is a client error, not a server error')
const brokenCookie = await api(
  new Request('https://api.example/v1/guestbook', { headers: { Cookie: '__Host-tom_visitor=%E0%A4%A' } }),
)
assert(brokenCookie.status === 200, 'a malformed cookie value counts as no cookie')

const contractStore = new MemoryStore()
await checkStoreContract(contractStore, assert)
await checkPostgresStoreContract(process.env.TEST_DATABASE_URL?.trim(), assert)
await checkLoginFlow(assert)
await checkGuestbookFlow(assert)
await checkTownFlow(assert)
await checkDerbyJudge(assert)
await checkLeaderboardFlow(assert)
await checkLeaderboardReviewFlow(assert)
await checkSiteStatsFlow(assert)

console.log(`ok - ${assertions} assertions`)

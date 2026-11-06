import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { resolve } from 'node:path'
import { loadEnvFile } from 'node:process'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import {
  applyMigrations,
  BackendService,
  createApi,
  createLinkedInOidcFromEnvironment,
  createOpenRouterFromEnvironment,
  MemoryStore,
  parseEmailList,
  PostgresStore,
  seedTown,
} from './dist/src/index.js'

// The root `.env` and a relative TOWN_SEED_PATH are both found from the repository root, wherever node starts.
const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const environmentFile = resolve(repositoryRoot, '.env')
if (existsSync(environmentFile)) loadEnvFile(environmentFile)

const maximumRequestBytes = 1024 * 1024
const host = process.env.HOST ?? '127.0.0.1'
const port = Number.parseInt(process.env.PORT ?? '3000', 10)
const allowedOrigins = new Set(
  (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
)
const store = await createStore(process.env.DATABASE_URL?.trim())
if (await store.seedAdminEmails(parseEmailList(process.env.ADMIN_EMAILS))) {
  console.log('Filled the empty admin list from ADMIN_EMAILS; edit it at /admin from now on.')
}
await seedTown(store, resolve(repositoryRoot, process.env.TOWN_SEED_PATH?.trim() || 'backend/seed/town.json'), console)
const linkedInOidc = createLinkedInOidcFromEnvironment(
  process.env,
  `http://localhost:${port}/v1/auth/linkedin/callback`,
)
const dialogueGenerator = createOpenRouterFromEnvironment(process.env)
const api = createApi({
  service: new BackendService(store, dialogueGenerator),
  authStore: store,
  allowedOrigins,
  linkedInOidc,
  frontendUrl: process.env.FRONTEND_URL?.trim() || 'http://localhost:5173/admin',
})

export async function createStore(databaseUrl) {
  if (!databaseUrl) {
    console.warn('DATABASE_URL is not set; using the in-memory store, which resets on every restart.')
    return new MemoryStore()
  }
  const pool = new pg.Pool({ connectionString: databaseUrl })
  pool.on('error', logLostDatabaseConnection)
  // A connection a request holds has no pool listener, and its loss already fails the request's query; without a
  // listener of its own, that loss would also end the process as an unhandled `error` event.
  pool.on('connect', (client) => client.on('error', () => undefined))
  const applied = await applyMigrations(pool, new URL('./migrations/', import.meta.url)).catch(stopWithDatabaseHint)
  if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`)
  return new PostgresStore(pool)
}

/**
 * An idle connection dropped, as a PostgreSQL restart does; the pool opens a new one for the next query. Only the error
 * code is logged, because a driver error's message and fields can name the host, the user, and the database.
 */
export function logLostDatabaseConnection(error) {
  console.error(
    `Lost an idle PostgreSQL connection (${error?.code ?? 'no error code'}); the next query opens a new one.`,
  )
}

/** A refused connection at startup almost always means PostgreSQL is not running, so say how to fix it. */
export function stopWithDatabaseHint(error) {
  if (error?.code !== 'ECONNREFUSED') throw error
  console.error(
    'Could not reach PostgreSQL at DATABASE_URL. Start it with `docker compose up -d postgres`, or leave DATABASE_URL empty to use the in-memory store.',
  )
  process.exit(1)
}

export async function readBody(request) {
  const chunks = []
  let receivedBytes = 0
  for await (const chunk of request) {
    receivedBytes += chunk.length
    assertWithinRequestLimit(receivedBytes)
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

/** Stops reading an oversized body at the limit instead of buffering all of it first. */
export function assertWithinRequestLimit(receivedBytes) {
  if (receivedBytes > maximumRequestBytes) throw new Error('REQUEST_TOO_LARGE')
}

export async function toWebRequest(request) {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? `${host}:${port}`}`)
  const body = ['GET', 'HEAD'].includes(request.method ?? 'GET') ? undefined : await readBody(request)
  return new Request(url, {
    method: request.method,
    headers: request.headers,
    body,
  })
}

export async function sendWebResponse(webResponse, response) {
  const setCookies = webResponse.headers.getSetCookie()
  const otherHeaders = [...webResponse.headers].filter(([name]) => name !== 'set-cookie')
  otherHeaders.forEach(([name, value]) => response.setHeader(name, value))
  if (setCookies.length) response.setHeader('Set-Cookie', setCookies)
  response.writeHead(webResponse.status)
  response.end(Buffer.from(await webResponse.arrayBuffer()))
}

const server = createServer(async (request, response) => {
  try {
    await sendWebResponse(await api(await toWebRequest(request)), response)
  } catch (error) {
    const requestTooLarge = error instanceof Error && error.message === 'REQUEST_TOO_LARGE'
    response.writeHead(requestTooLarge ? 413 : 500, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ error: { code: requestTooLarge ? 'REQUEST_TOO_LARGE' : 'INTERNAL' } }))
  }
})

server.once('error', (error) => {
  console.error(`Backend failed to start: ${error.message}`)
  process.exitCode = 1
})
server.listen(port, host, () => console.log(`Town of Me backend listening on http://${host}:${port}`))

export function shutdown() {
  server.close(() => process.exit())
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)

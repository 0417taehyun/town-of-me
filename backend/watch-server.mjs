import { spawn } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'

let serverProcess
let restartTimer
let restarting = false
const compiledSourceUrl = new URL('./dist/src/', import.meta.url)

export async function newestCompiledModifiedTime() {
  const fileNames = await readdir(compiledSourceUrl)
  const modifiedTimes = await Promise.all(
    fileNames.map(async (fileName) => (await stat(new URL(fileName, compiledSourceUrl))).mtimeMs),
  )
  return Math.max(0, ...modifiedTimes)
}

export function startServer() {
  serverProcess = spawn(process.execPath, ['server.mjs'], { stdio: 'inherit' })
  serverProcess.once('exit', (code) => {
    if (restarting) {
      restarting = false
      startServer()
      return
    }
    clearInterval(restartInterval)
    process.exit(code ?? 1)
  })
}

export function scheduleRestart() {
  clearTimeout(restartTimer)
  restartTimer = setTimeout(() => {
    restarting = true
    serverProcess.kill()
  }, 100)
}

let previousModifiedTime = await newestCompiledModifiedTime()
const restartInterval = setInterval(async () => {
  const currentModifiedTime = await newestCompiledModifiedTime()
  if (currentModifiedTime === previousModifiedTime) return
  previousModifiedTime = currentModifiedTime
  scheduleRestart()
}, 250)
startServer()

export function shutdown() {
  clearInterval(restartInterval)
  clearTimeout(restartTimer)
  serverProcess.kill()
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)

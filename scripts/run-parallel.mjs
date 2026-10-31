import { spawn } from 'node:child_process'

const scriptNames = process.argv.slice(2)
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const children = scriptNames.map((scriptName) => spawn(npmCommand, ['run', scriptName], { stdio: 'inherit' }))
let stopping = false

function stop(exitCode) {
  if (stopping) return
  stopping = true
  process.exitCode = exitCode
  children.filter((child) => child.exitCode === null && child.signalCode === null).forEach((child) => child.kill())
}

children.forEach((child) => {
  child.once('error', () => stop(1))
  child.once('exit', (code, signal) => stop(code ?? (signal ? 1 : 0)))
})

process.once('SIGINT', () => stop(130))
process.once('SIGTERM', () => stop(143))

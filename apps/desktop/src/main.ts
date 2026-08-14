/**
 * Electron main-process entry for the DeepSeek Harness desktop shell.
 *
 * The first runnable milestone is intentionally app-local: it starts the
 * existing Web profile on a private loopback port, then loads that URL in an
 * Electron window. The production desktop transport will replace this with
 * file:// frontend loading plus preload IPC.
 * @module @deepseek-ai/dsh-desktop/main
 */

import { app, BrowserWindow } from 'electron'
import { spawn, type ChildProcessByStdio } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'

const PRELOAD_PATH = fileURLToPath(new URL('./preload.cjs', import.meta.url))
const REPOSITORY_ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const CLI_SOURCE_ENTRY = join(REPOSITORY_ROOT, 'apps/cli/src/bin.ts')
const PACKAGED_RUNTIME_ENTRY = 'lib/bin.js'
const WEB_READY_PATTERN = /dsh web: (http:\/\/127\.0\.0\.1:\d+)/u
const STARTUP_TIMEOUT_MS = 30_000
const SHUTDOWN_TIMEOUT_MS = 5_000

interface RuntimeLaunch {
  readonly command: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env: NodeJS.ProcessEnv
  readonly description: string
}

interface RuntimeHandle {
  readonly process: RuntimeProcess
  readonly url: string
}

type RuntimeProcess = ChildProcessByStdio<null, Readable, Readable>

let runtime: RuntimeHandle | undefined

console.log('[dsh-desktop] main process loaded')

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
}

function desktopStatusHtml(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>DeepSeek Harness Desktop</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #111318;
        color: #f5f7fb;
      }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
      }
      main {
        width: min(680px, calc(100vw - 48px));
      }
      h1 {
        margin: 0 0 12px;
        font-size: 28px;
        font-weight: 650;
        letter-spacing: 0;
      }
      p {
        margin: 0;
        color: #bbc2cf;
        font-size: 15px;
        line-height: 1.6;
      }
      code {
        color: #ffffff;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(body)}</p>
    </main>
  </body>
</html>`
}

async function createWindow(): Promise<void> {
  const window = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    title: 'DeepSeek Harness',
    backgroundColor: '#111318',
    webPreferences: {
      preload: PRELOAD_PATH,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(desktopStatusHtml(
    'Starting DeepSeek Harness',
    'Electron is launching the existing Web profile on a private loopback port.',
  ))}`)
  try {
    console.log('[dsh-desktop] starting Harness Web profile')
    runtime ??= await startHarnessRuntime()
    console.log(`[dsh-desktop] loading ${runtime.url}`)
    await window.loadURL(runtime.url)
  } catch (error) {
    console.error('[dsh-desktop] failed to start Harness runtime:', error)
    await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(desktopStatusHtml(
      'DeepSeek Harness Failed To Start',
      error instanceof Error ? error.message : String(error),
    ))}`)
  }
}

function startHarnessRuntime(): Promise<RuntimeHandle> {
  const launch = resolveRuntimeLaunch()
  const child = spawn(launch.command, launch.args, {
    cwd: launch.cwd,
    env: launch.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  return new Promise((resolve, reject) => {
    let settled = false
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => {
      finish(new Error(`timed out waiting for dsh web URL after ${String(STARTUP_TIMEOUT_MS)}ms`))
    }, STARTUP_TIMEOUT_MS)

    const finish = (error: Error | undefined, url?: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (error !== undefined) {
        stopHarnessRuntime(child)
        reject(error)
        return
      }
      if (url === undefined) {
        stopHarnessRuntime(child)
        reject(new Error('dsh web reported readiness without a URL'))
        return
      }
      resolve({ process: child, url })
    }

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
      process.stdout.write(chunk)
      const match = WEB_READY_PATTERN.exec(stdout)
      if (match?.[1] !== undefined) finish(undefined, match[1])
    })
    child.stderr.on('data', (chunk: string) => {
      stderr += chunk
      process.stderr.write(chunk)
    })
    child.on('error', (error) => {
      finish(new Error(`failed to launch ${launch.description} from ${dirname(launch.args[0] ?? launch.cwd)}: ${error.message}`))
    })
    child.on('exit', (code, signal) => {
      if (settled) return
      const detail = stderr.trim() || stdout.trim() || `process exited with code ${String(code)} signal ${String(signal)}`
      finish(new Error(`dsh web exited before reporting a URL: ${detail}`))
    })
  })
}

function resolveRuntimeLaunch(): RuntimeLaunch {
  const overrideRoot = process.env.DSH_DESKTOP_RUNTIME_ROOT
  if (overrideRoot !== undefined && overrideRoot !== '') {
    return builtRuntimeLaunch(overrideRoot, process.env.DSH_DESKTOP_NODE ?? 'node', false)
  }
  if (app.isPackaged) {
    return builtRuntimeLaunch(join(process.resourcesPath, 'runtime'), process.execPath, true)
  }
  return {
    command: process.env.DSH_DESKTOP_NODE ?? 'node',
    args: ['--import', 'tsx/esm', CLI_SOURCE_ENTRY, 'web', '--port', '0'],
    cwd: REPOSITORY_ROOT,
    env: process.env,
    description: 'source Harness runtime',
  }
}

function builtRuntimeLaunch(runtimeRoot: string, command: string, electronAsNode: boolean): RuntimeLaunch {
  const entry = join(runtimeRoot, PACKAGED_RUNTIME_ENTRY)
  if (!existsSync(entry)) {
    throw new Error(`packaged Harness runtime is missing ${PACKAGED_RUNTIME_ENTRY} under ${runtimeRoot}`)
  }
  return {
    command,
    args: ['--expose-internals', entry, 'web', '--port', '0'],
    cwd: runtimeRoot,
    env: electronAsNode ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' } : process.env,
    description: 'packaged Harness runtime',
  }
}

function stopHarnessRuntime(child: RuntimeProcess): void {
  if (child.exitCode !== null || child.signalCode !== null) return
  child.kill('SIGTERM')
  setTimeout(() => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
  }, SHUTDOWN_TIMEOUT_MS).unref()
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow()
})

app.on('before-quit', () => {
  if (runtime !== undefined) stopHarnessRuntime(runtime.process)
})

void app.whenReady().then(async () => {
  console.log('[dsh-desktop] Electron app ready')
  await createWindow()
}).catch((error: unknown) => {
  console.error('[dsh-desktop] failed during Electron startup:', error)
  app.quit()
})

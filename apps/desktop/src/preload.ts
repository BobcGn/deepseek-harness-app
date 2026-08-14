/**
 * Electron preload entry for the DeepSeek Harness desktop shell.
 *
 * This file is deliberately tiny until the IPC transport lands. Renderer code
 * must never receive raw Node or Electron primitives.
 * @module @deepseek-ai/dsh-desktop/preload
 */

import { contextBridge } from 'electron'

export interface DesktopBridge {
  /** Current bridge protocol version. */
  readonly version: 1
}

const bridge: DesktopBridge = { version: 1 }

contextBridge.exposeInMainWorld('dshDesktop', bridge)

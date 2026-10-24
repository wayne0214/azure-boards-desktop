/**
 * The UI side of the local MCP server (src-tauri/src/mcp): tells it what is open in the window,
 * and reloads items an AI tool changed. Self-contained; see src-tauri/src/mcp/README.md to remove it.
 */
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { isTauri } from './api'
import { useAppStore } from '@/store/useAppStore'
import { useBoardStore } from '@/store/useBoardStore'
import { useUiStore } from '@/store/useUiStore'

export type SetupState = 'ready' | 'outdated' | 'missing' | 'notInstalled'

export interface McpClient {
  id: 'claude' | 'codex'
  name: string
  state: SetupState
  /** Why the last setup or removal failed. */
  detail: string | null
}

export interface McpStatus {
  enabled: boolean
  readOnly: boolean
  port: number
  token: string
  running: boolean
  url: string
  error: string | null
  clients: McpClient[]
}

export const mcpStatus = () => invoke<McpStatus>('mcp_status')
export const mcpConfigure = (enabled: boolean, readOnly: boolean, port?: number) => invoke<McpStatus>('mcp_configure', { enabled, readOnly, port })
export const mcpNewToken = () => invoke<McpStatus>('mcp_new_token')
export const mcpQuickSetup = () => invoke<McpStatus>('mcp_quick_setup')
export const mcpSetupClient = (id: McpClient['id']) => invoke<McpStatus>('mcp_setup_client', { id })
export const mcpRemoveClient = (id: McpClient['id']) => invoke<McpStatus>('mcp_remove_client', { id })

export const claudeCommand = (s: McpStatus) => `claude mcp add --scope user --transport http boards ${s.url} --header "Authorization: Bearer ${s.token}"`
export const codexConfig = (s: McpStatus) => `[mcp_servers.boards]\nurl = "${s.url}"\nhttp_headers = { Authorization = "Bearer ${s.token}" }`

function currentContext() {
  const app = useAppStore.getState()
  const board = useBoardStore.getState()
  const id = board.selectedId
  const item = id === null ? null : board.items.find((i) => i.id === id) ?? (board.detached?.id === id ? board.detached : null)
  const f = item?.fields ?? {}
  return {
    org: app.activeOrg,
    project: app.selectedProject?.name ?? null,
    team: app.selectedTeam?.name ?? null,
    view: useUiStore.getState().view,
    selectedItem: item
      ? { id: item.id, type: f['System.WorkItemType'] ?? null, title: f['System.Title'] ?? null, state: f['System.State'] ?? null, project: f['System.TeamProject'] ?? null }
      : null,
  }
}

let started = false

/** Start once at boot; does nothing outside the desktop app. */
export function startMcpBridge() {
  if (!isTauri || started) return
  started = true
  let last = ''
  let timer: ReturnType<typeof setTimeout> | undefined
  const push = () => {
    clearTimeout(timer)
    timer = setTimeout(() => {
      const ctx = currentContext()
      const json = JSON.stringify(ctx)
      if (json === last) return
      last = json
      void invoke('mcp_set_context', { context: ctx }).catch(() => undefined)
    }, 250)
  }
  useAppStore.subscribe(push)
  useBoardStore.subscribe(push)
  useUiStore.subscribe(push)
  push()
  void listen<{ id: number | null }>('mcp-changed', (e) => {
    const id = e.payload.id
    if (typeof id !== 'number') return
    const board = useBoardStore.getState()
    if (board.selectedId === id || board.items.some((i) => i.id === id)) void board.reloadItem(id)
  })
}

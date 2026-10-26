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
import { useImportStore } from '@/components/imports/useImportStore'

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

// ----- staged imports (Boards → Imports) -----

export type ImportStatus = 'pending' | 'applying' | 'applied' | 'discarded' | 'superseded'

export interface ImportSummary {
  create: number
  update: number
  skip: number
  remove: number
  error: number
  rowsWithConflicts: number
}

export interface ImportResultRow {
  rowKey: string
  row: number | null
  key: string | null
  title: string | null
  action: string | null
  workItemId: number | null
  ok: boolean
  error?: string
  /** "not picked" for rows the user left out, "nothing to change" for picked rows already the same. */
  skipped?: string
  /** E.g. a removal that could only be tagged. */
  note?: string | null
}

export interface ImportResult {
  project: string
  done: number
  failed: number
  notPicked: number
  /** Picked rows that had nothing to write. */
  unchanged: number
  results: ImportResultRow[]
}

export interface ImportInfo {
  id: string
  org: string
  project: string
  source: string | null
  /** Milliseconds since 1970. */
  created: number
  status: ImportStatus
  summary: ImportSummary
  rows: number
  removeMissing: boolean
  result: ImportResult | null
  finished: number | null
}

/** `add`: links added beside the ones already there (Tested By). */
export type ChangeKind = 'set' | 'fill' | 'conflict' | 'same' | 'add'

export interface FieldChange {
  /** Reference name, or "System.Parent". */
  field: string
  name: string
  kind: ChangeKind
  before: string
  after: string
  /** Written as planned (conflicts only when the file's side was picked). */
  write: boolean
  /** Why the file's side cannot be used (e.g. shared steps). */
  locked?: string
}

export type RowCategory = 'new' | 'changed' | 'conflict' | 'same' | 'missing' | 'error'

export interface ReviewRow {
  rowKey: string
  /** Sent back on apply; a row whose item changed since is left alone. */
  fp: string
  category: RowCategory
  type: string
  key: string | null
  title: string | null
  workItemId: number | null
  matchedBy: 'key' | 'title' | null
  parent: number | string | null
  /** Row key of a parent created by this same import. */
  parentRow: string | null
  error: string | null
  note: string | null
  changes: FieldChange[]
}

export interface ImportReview {
  project: string
  summary: ImportSummary
  /** Why items only in Boards were not looked for. */
  removalsHeld: string | null
  rows: ReviewRow[]
  import: ImportInfo
}

export interface ImportPick {
  rowKey: string
  fp: string
  /** Conflict fields that take the file's value. */
  takeFile: string[]
  /** Fields whose file text the user edited: reference name → the text to use instead. */
  edits?: Record<string, string>
}

export const mcpImports = () => invoke<ImportInfo[]>('mcp_imports')
export const mcpImportReview = (id: string) => invoke<ImportReview>('mcp_import_review', { id })
export const mcpImportApply = (id: string, picks: ImportPick[]) => invoke<ImportResult>('mcp_import_apply', { id, picks })
export const mcpImportDiscard = (id: string) => invoke<void>('mcp_import_discard', { id })

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

/** What open_pull_request_form sends: the New pull request form's values. */
export interface McpPrForm {
  projectId: string
  repoId: string
  source: string
  target: string
  title: string
  description: string
  isDraft: boolean
  workItemIds: number[]
}

/**
 * Open the New pull request form filled in by an AI tool; the user creates it. When another form is
 * open, offer it in a toast instead so what the user is typing is not lost.
 */
export function openPrForm(form: McpPrForm) {
  const open = () => {
    const ui = useUiStore.getState()
    ui.setView('prs')
    ui.openSheet('new-pr', { ...form, nonce: Date.now() })
  }
  if (!useUiStore.getState().sheet) { open(); return }
  useUiStore.getState().toast({
    kind: 'info',
    title: 'Pull request ready to review',
    detail: form.title,
    sticky: true,
    action: { label: 'Open', onClick: open },
  })
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
  // A newly staged import: refresh the list and offer to review it.
  void listen('mcp-imports', () => {
    const known = new Set(useImportStore.getState().list.map((i) => i.id))
    void useImportStore.getState().load().then(() => {
      const { list, select } = useImportStore.getState()
      const newest = list.find((i) => i.status === 'pending')
      if (!newest || known.has(newest.id)) return
      useUiStore.getState().toast({
        kind: 'info',
        title: 'Import ready to review',
        detail: `${newest.source ?? 'Staged by an AI tool'} · ${newest.project}`,
        action: { label: 'Review', onClick: () => { select(newest.id); useUiStore.getState().setView('imports') } },
      })
    })
  })
  void listen<McpPrForm>('mcp-open-pr', (e) => openPrForm(e.payload))
  void listen<{ id: number | null }>('mcp-changed', (e) => {
    const id = e.payload.id
    if (typeof id !== 'number') return
    const board = useBoardStore.getState()
    if (board.selectedId === id || board.items.some((i) => i.id === id)) void board.reloadItem(id)
  })
}

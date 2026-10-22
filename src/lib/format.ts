import type { Board, BoardColumn, IdentityRef, WorkItem, WorkItemType } from './types'

export function relativeTime(iso: string | undefined | null): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diff = Date.now() - t
  const s = Math.round(diff / 1000)
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return h === 1 ? '1 hour ago' : `${h} hours ago`
  const d = Math.round(h / 24)
  if (d < 7) return d === 1 ? 'yesterday' : `${d} days ago`
  if (d < 30) return `${Math.round(d / 7)} wk ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function shortDate(iso: string | undefined | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function longDate(iso: string | undefined | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function initials(name: string | undefined | null): string {
  if (!name) return '?'
  const clean = name.replace(/<.*>/, '').trim()
  const parts = clean.split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const avatarHues = [208, 160, 28, 280, 340, 95, 190, 250, 10, 60]
export function avatarHue(key: string | undefined | null): number {
  if (!key) return 0
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return avatarHues[h % avatarHues.length]
}

type AnyIdentity = { id?: string | null; displayName?: string | null; uniqueName?: string | null } | IdentityRef | string | undefined | null

export function identityName(ref: AnyIdentity | unknown): string {
  if (!ref) return ''
  if (typeof ref === 'string') return ref.replace(/\s*<.*>$/, '')
  if (typeof ref === 'object') return (ref as { displayName?: string }).displayName ?? ''
  return ''
}

export function identityKey(ref: AnyIdentity | unknown): string {
  if (!ref) return ''
  if (typeof ref === 'string') return ref
  if (typeof ref !== 'object') return ''
  const r = ref as { id?: string | null; displayName?: string | null; uniqueName?: string | null }
  return r.uniqueName ?? r.id ?? r.displayName ?? ''
}

export function tagsOf(item: WorkItem): string[] {
  const raw = item.fields['System.Tags']
  if (!raw || typeof raw !== 'string') return []
  return raw.split(';').map((t) => t.trim()).filter(Boolean)
}

/** Azure DevOps default colors, used when the type list for a project is not loaded (e.g. My Work). */
const defaultTypeColors: Record<string, string> = {
  Epic: 'E06C00', Feature: '773B93', 'User Story': '0098C7', 'Product Backlog Item': '009CCC', Requirement: '009CCC',
  Bug: 'CC293D', Task: 'F2CB1D', Issue: 'B4009E', Impediment: 'B4009E', 'Test Case': '004B50', 'Change Request': 'B4009E', Risk: 'B4009E', Review: 'B4009E',
}

export function typeColor(types: WorkItemType[], name: string | undefined): string {
  const t = types.find((x) => x.name === name)
  const hex = t?.color ?? (name ? defaultTypeColors[name] : undefined) ?? `hsl(${avatarHue(name)} 45% 55%)`
  return hex.startsWith('hsl') ? hex : `#${hex.replace('#', '')}`
}

const categoryColors: Record<string, string> = { Proposed: 'b2b2b2', InProgress: '007acc', Resolved: 'ff9d00', Completed: '339933', Removed: '8a8a8a' }

export function stateColor(types: WorkItemType[], typeName: string | undefined, state: string | undefined): string {
  const t = types.find((x) => x.name === typeName)
  const s = t?.states.find((x) => x.name === state)
  const hex = s?.color || (s?.category ? categoryColors[s.category] : undefined) || guessStateColor(state)
  return `#${hex.replace('#', '')}`
}

function guessStateColor(state: string | undefined): string {
  const n = (state ?? '').toLowerCase()
  if (/closed|done|complete|resolved/.test(n)) return '339933'
  if (/active|progress|doing|review|committed|approved/.test(n)) return '007acc'
  return 'b2b2b2'
}

export function boardFields(board: Board | null) {
  return {
    column: board?.fields?.columnField?.referenceName ?? 'System.BoardColumn',
    row: board?.fields?.rowField?.referenceName ?? 'System.BoardLane',
    done: board?.fields?.doneField?.referenceName ?? 'System.BoardColumnDone',
  }
}

/** Decide which column an item belongs in: explicit board column field first, then state mapping. */
export function columnFor(board: Board, item: WorkItem): BoardColumn | null {
  const f = boardFields(board)
  const explicit = item.fields[f.column] as string | undefined
  if (explicit) {
    const c = board.columns.find((x) => x.name === explicit)
    if (c) return c
  }
  const state = item.fields['System.State'] as string | undefined
  const type = item.fields['System.WorkItemType'] as string | undefined
  if (!state || !type) return board.columns[0] ?? null
  // Prefer the first column whose mapping matches the state for this type.
  const match = board.columns.find((c) => c.stateMappings?.[type] === state)
  return match ?? board.columns[0] ?? null
}

export function isDone(board: Board, item: WorkItem): boolean {
  const f = boardFields(board)
  return Boolean(item.fields[f.done])
}

export function boardTypes(board: Board | null): string[] {
  if (!board) return []
  const set = new Set<string>()
  for (const c of board.columns) for (const t of Object.keys(c.stateMappings ?? {})) set.add(t)
  return [...set]
}

export function doneStates(board: Board | null): string[] {
  if (!board) return []
  const set = new Set<string>()
  for (const c of board.columns) {
    if (c.columnType === 'outgoing') for (const s of Object.values(c.stateMappings ?? {})) set.add(s)
  }
  return [...set]
}

export function itemUrl(org: string, project: string, id: number): string {
  return `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_workitems/edit/${id}`
}

export function boardUrl(org: string, project: string, team: string, board: string): string {
  return `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_boards/board/t/${encodeURIComponent(team)}/${encodeURIComponent(board)}`
}

/**
 * Parse HTML from Azure DevOps without running it. A detached `div.innerHTML` still loads images and fires
 * their `onerror` handlers in the app window; a DOMParser document is inert.
 */
export function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}

export function htmlToText(html: string | undefined | null): string {
  if (!html) return ''
  return (parseHtml(html).body.textContent ?? '').replace(/\s+/g, ' ').trim()
}

export function priorityLabel(p: number | undefined): string {
  if (p === undefined || p === null) return ''
  return `P${p}`
}

export function pointsOf(item: WorkItem): number | undefined {
  const f = item.fields
  const v = f['Microsoft.VSTS.Scheduling.StoryPoints'] ?? f['Microsoft.VSTS.Scheduling.Effort'] ?? f['Microsoft.VSTS.Scheduling.Size']
  return typeof v === 'number' ? v : undefined
}

/**
 * One CSV cell. Text starting with = + - @ would run as a formula when the file is opened in Excel,
 * so it gets a leading apostrophe; `csvUnguard` takes it off again when such a file is imported.
 */
export function csvEscape(v: unknown): string {
  let s = v === undefined || v === null ? '' : String(v)
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

// A value that really began with an apostrophe before a formula character loses it on import; that trade is deliberate.
export const csvUnguard = (cell: string) => cell.replace(/^'(?=[=+\-@\t\r])/, '')

export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
export const modKey = isMac ? '⌘' : 'Ctrl'

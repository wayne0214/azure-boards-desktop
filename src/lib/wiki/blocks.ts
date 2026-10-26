import type { ItemFilter } from './types'

/**
 * A live block: a fenced ```boards block on a page that Boards fills in with what is true now.
 * In the Azure DevOps web wiki it stays a readable code block.
 */
export type LiveBlock =
  | { kind: 'items'; filter: ItemFilter }
  | { kind: 'item'; id: number }
  | { kind: 'prs'; status: 'active' | 'completed' | 'all'; repo: string | null; limit: number }
  | { kind: 'pages'; list: 'decisions' | 'feedback'; under: string | null }
  | { kind: 'error'; message: string }

export const BLOCK_LANG = 'boards'

/** Blocks offered in the editor, ready to change. */
export const BLOCK_EXAMPLES: { label: string; text: string }[] = [
  { label: 'Work items (a query)', text: 'items: Bug\nstate: Active, New\nsprint: current\nlimit: 20' },
  { label: 'My work this sprint', text: 'items: all\nsprint: current\nassigned: me' },
  { label: 'One work item, as it is now', text: 'item: 123' },
  { label: 'Pull requests', text: 'prs: active\nlimit: 10' },
  { label: 'Decision index', text: 'decisions' },
  { label: 'Feedback and what it became', text: 'feedback' },
]

const list = (v: string) => v.split(/[,;]/).map((s) => s.trim()).filter(Boolean)

/** "7d", "2 weeks" or a date, as YYYY-MM-DD. */
export function sinceDate(v: string, now = new Date()): string | null {
  const s = v.trim().toLowerCase()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = /^(\d{1,3})\s*(d|days?|w|weeks?)$/.exec(s)
  if (!m) return null
  const days = Number(m[1]) * (m[2].startsWith('w') ? 7 : 1)
  const d = new Date(now.getTime() - days * 86400000)
  return d.toISOString().slice(0, 10)
}

export function parseBlock(text: string, now = new Date()): LiveBlock {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  if (lines.length === 0) return { kind: 'error', message: 'Empty block. Start it with items:, item:, prs:, decisions or feedback.' }
  const pairs = lines.map((l) => {
    const i = l.indexOf(':')
    return i < 0 ? [l.toLowerCase(), ''] : [l.slice(0, i).trim().toLowerCase(), l.slice(i + 1).trim()]
  })
  const [first, value] = pairs[0]
  const opt = new Map(pairs.slice(1) as [string, string][])
  const limit = Math.min(Math.max(Number(opt.get('limit') ?? '') || 0, 0), 200)
  switch (first) {
    case 'items':
    case 'work items': {
      const filter: ItemFilter = {}
      const types = /^(all|any|)$/i.test(value) ? [] : list(value)
      if (types.length) filter.types = types
      const states = list(opt.get('state') ?? opt.get('states') ?? '')
      if (states.length) filter.states = states
      const sprint = opt.get('sprint') ?? opt.get('iteration')
      if (sprint) filter.iteration = /^current$/i.test(sprint) ? 'current' : sprint
      if (/^me$/i.test(opt.get('assigned') ?? opt.get('assignedto') ?? '')) filter.assignedToMe = true
      if (opt.get('text')) filter.text = opt.get('text')
      const changed = opt.get('changed') ?? opt.get('changed since')
      if (changed) {
        const d = sinceDate(changed, now)
        if (!d) return { kind: 'error', message: `"changed: ${changed}" should be a date like 2026-10-01, or e.g. 7d.` }
        filter.changedSince = d
      }
      filter.limit = limit || 50
      return { kind: 'items', filter }
    }
    case 'item': {
      const id = Number(value.replace(/^#/, ''))
      return Number.isInteger(id) && id > 0 ? { kind: 'item', id } : { kind: 'error', message: 'Give a work item number: item: 123' }
    }
    case 'prs':
    case 'pull requests': {
      const status = (value || 'active').toLowerCase()
      if (status !== 'active' && status !== 'completed' && status !== 'all') return { kind: 'error', message: 'prs: takes active, completed or all.' }
      return { kind: 'prs', status, repo: opt.get('repo') ?? opt.get('repository') ?? null, limit: limit || 10 }
    }
    case 'decisions':
    case 'feedback':
      return { kind: 'pages', list: first, under: value || opt.get('under') || null }
    default:
      return { kind: 'error', message: `Unknown block "${first}". Use items:, item:, prs:, decisions or feedback.` }
  }
}

/** A short description of a block, for its header. */
export function describe(b: LiveBlock): string {
  switch (b.kind) {
    case 'items': {
      const f = b.filter
      return [f.types?.join(', ') || 'Work items', f.states?.join(', '), f.iteration === 'current' ? 'current sprint' : f.iteration, f.assignedToMe && 'assigned to me', f.text && `“${f.text}”`, f.changedSince && `changed since ${f.changedSince}`].filter(Boolean).join(' · ')
    }
    case 'item': return `#${b.id}`
    case 'prs': return `${b.status === 'all' ? 'All' : b.status === 'active' ? 'Active' : 'Completed'} pull requests${b.repo ? ` · ${b.repo}` : ''}`
    case 'pages': return b.list === 'decisions' ? 'Decisions' : 'Feedback'
    case 'error': return 'Live block'
  }
}

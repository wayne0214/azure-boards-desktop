import type { WorkItem, WorkItemType } from './types'

const SLUG_MAX = 40
// Words that read badly at the end of a cut-off name.
const TRAILING = new Set(['a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'into', 'on', 'for', 'with', 'by', 'at', 'from'])

/** Lowercase, ASCII, words joined by hyphens, cut at a word boundary. */
export function branchSlug(title: string): string {
  const words = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  let out = ''
  for (const w of words) {
    const next = out ? `${out}-${w}` : w
    if (next.length > SLUG_MAX) break
    out = next
  }
  const kept = out.split('-')
  while (kept.length > 1 && TRAILING.has(kept[kept.length - 1])) kept.pop()
  out = kept.join('-')
  return out || (words[0] ?? '').slice(0, SLUG_MAX)
}

/** feature/1234-short-title, or bugfix/1234-short-title for bugs. */
export function suggestBranchName(id: number, type: string, title: string): string {
  const prefix = type === 'Bug' ? 'bugfix' : 'feature'
  const slug = branchSlug(title)
  return slug ? `${prefix}/${id}-${slug}` : `${prefix}/${id}`
}

/** Why a branch name is not acceptable to Git, or null when it is (the rules of `git check-ref-format --branch`). */
export function branchNameProblem(name: string): string | null {
  if (!name.trim()) return 'Enter a branch name.'
  if (/\s/.test(name)) return 'Branch names cannot contain spaces.'
  if (/[~^:?*[\\\x00-\x1f\x7f]/.test(name)) return 'Branch names cannot contain ~ ^ : ? * [ or \\.'
  if (name.startsWith('-') || name.startsWith('/')) return 'A branch name cannot start with - or /.'
  if (name.endsWith('/') || name.endsWith('.') || name.endsWith('.lock')) return 'A branch name cannot end with /, . or .lock.'
  if (name.includes('..') || name.includes('//') || name.includes('@{') || name === '@') return 'A branch name cannot contain .., // or @{.'
  if (name.split('/').some((part) => part.startsWith('.'))) return 'No part of a branch name can start with a dot.'
  return null
}

/** The first "in progress" state of a type, to move a not-yet-started item to. Null when the item is already past that. */
export function startState(wit: WorkItemType | undefined, current: string): string | null {
  if (!wit) return null
  const cat = wit.states.find((s) => s.name === current)?.category
  if (cat && cat !== 'Proposed') return null
  return wit.states.find((s) => s.category === 'InProgress')?.name ?? null
}

export type DevLink =
  | { kind: 'branch'; projectId: string; repoId: string; name: string }
  | { kind: 'pr'; projectId: string; repoId: string; prId: number }

/** Branches and pull requests linked to a work item, from its relations. */
export function devLinks(item: WorkItem): DevLink[] {
  const out: DevLink[] = []
  for (const r of item.relations ?? []) {
    if (r.rel !== 'ArtifactLink') continue
    const branch = r.url.match(/^vstfs:\/\/\/Git\/Ref\/([^%]+)%2F([^%]+)%2FGB(.+)$/i)
    if (branch) {
      out.push({ kind: 'branch', projectId: branch[1], repoId: branch[2], name: safeDecode(branch[3]) })
      continue
    }
    const pr = r.url.match(/^vstfs:\/\/\/Git\/PullRequestId\/([^%]+)%2F([^%]+)%2F(\d+)$/i)
    if (pr) out.push({ kind: 'pr', projectId: pr[1], repoId: pr[2], prId: Number(pr[3]) })
  }
  return out
}

function safeDecode(s: string): string {
  try { return decodeURIComponent(s) } catch { return s }
}

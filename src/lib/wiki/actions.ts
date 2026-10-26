import type { Identity } from '@/lib/types'
import { mentionedIds } from './pages'

/** A task-list line on a page: "- [ ] @Priya Natarajan check the upload limit". */
export interface ActionItem {
  /** The line as written. */
  raw: string
  done: boolean
  /** The text without the checkbox. */
  text: string
  /** Work items already on the line: a Task made from it, or what it is about. */
  ids: number[]
}

const LINE = /^\s*[-*+]\s+\[([ xX])\]\s+(.*\S)\s*$/
const MENTION_ID = /@<([0-9a-zA-Z-]{2,36})>/

/** Task-list lines outside code blocks. */
export function parseActions(markdown: string): ActionItem[] {
  const out: ActionItem[] = []
  let fence = false
  for (const raw of markdown.split('\n')) {
    if (/^\s*(```|~~~)/.test(raw)) { fence = !fence; continue }
    const m = fence ? null : LINE.exec(raw)
    if (m) out.push({ raw, done: m[1] !== ' ', text: m[2], ids: mentionedIds(m[2]) })
  }
  return out
}

/** Open actions with nothing linked yet and something to do: the ones Create tasks turns into Tasks. */
export const newActions = (markdown: string, people: Identity[] = []) =>
  parseActions(markdown).filter((a) => !a.done && a.ids.length === 0 && taskTitle(a.text, people).length > 2 && !/^@Name what to do\b/.test(a.text))

/**
 * Who an action is for: "@<id>", "@Display Name", or a leading "Name:" that starts one person's name
 * ("Tom: retake button" is Tomás Ferreira). Null when it names nobody, or more than one person.
 */
export function actionOwner(text: string, people: Identity[]): Identity | null {
  const byId = MENTION_ID.exec(text)?.[1]
  if (byId) return people.find((p) => p.id.toLowerCase() === byId.toLowerCase()) ?? null
  const named = [...people].sort((a, b) => b.displayName.length - a.displayName.length).find((p) => new RegExp(`(^|\\s)@${esc(p.displayName)}(?![\\w])`, 'i').test(text))
  if (named) return named
  const lead = /^([\p{L}][\p{L}' .-]{0,40}?):\s/u.exec(text)?.[1]?.toLowerCase()
  if (!lead) return null
  const hits = people.filter((p) => p.displayName.toLowerCase().startsWith(lead) || norm(p.displayName).startsWith(norm(lead)))
  return hits.length === 1 ? hits[0] : null
}

/** The Task's title: the action without its owner. */
export function taskTitle(text: string, people: Identity[]): string {
  let t = text.replace(/@<[0-9a-zA-Z-]{2,36}>/g, '')
  for (const p of people) t = t.replace(new RegExp(`(^|\\s)@${esc(p.displayName)}(?![\\w])`, 'gi'), '$1')
  t = t.replace(/^([\p{L}][\p{L}' .-]{0,40}?):\s/u, (m, name: string) => (actionOwner(`${name}: x`, people) ? '' : m))
  return t.replace(/\s+/g, ' ').replace(/^[\s–—:-]+|[\s–—:-]+$/g, '').trim()
}

/** The page with " #id" added to each line a Task was made from; lines are matched by text, so edits elsewhere are kept. */
export function linkTasks(markdown: string, made: { raw: string; id: number }[]): string {
  const left = [...made]
  return markdown
    .split('\n')
    .map((line) => {
      const i = left.findIndex((m) => m.raw === line)
      if (i < 0) return line
      const [m] = left.splice(i, 1)
      return `${line.replace(/\s+$/, '')} #${m.id}`
    })
    .join('\n')
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const norm = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

import type { ActionItem } from './actions'
import { pageTitle } from './pages'

/** Where each kind of page lives; teams can move pages, these are only where new ones start. */
export const MEETINGS = '/Meeting notes'
export const DECISIONS = '/Decision log'
export const FEEDBACK = '/Collaborator feedback'
export const SPRINTS = '/Sprint reviews'
export const RELEASES = '/Release notes'

export type TemplateId = 'blank' | 'meeting' | 'decision' | 'feedback' | 'sprint' | 'release'

export const TEMPLATES: { id: TemplateId; label: string; parent: string | null; hint: string }[] = [
  { id: 'blank', label: 'Blank page', parent: null, hint: '' },
  { id: 'meeting', label: 'Meeting notes', parent: MEETINGS, hint: 'Agenda, notes, decisions and actions; open actions from last time come along.' },
  { id: 'decision', label: 'Decision', parent: DECISIONS, hint: 'What was decided, why, and what it affects. Numbered in the decision log.' },
  { id: 'feedback', label: 'Feedback', parent: FEEDBACK, hint: 'Who said what, and the requirement it became.' },
  { id: 'sprint', label: 'Sprint review (drafted)', parent: SPRINTS, hint: 'Drafted from the sprint’s finished work and merged pull requests.' },
  { id: 'release', label: 'Release notes (drafted)', parent: RELEASES, hint: 'Drafted from pull requests merged since a date and their work items.' },
]

const pad = (n: number) => String(n).padStart(2, '0')
/** A local date as YYYY-MM-DD. */
export const isoDay = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** A page name with a date in front, the way meeting and feedback pages sort by date. */
export const datedName = (title: string, d = new Date()) => `${isoDay(d)} ${title.trim()}`.trim()

/** The next decision number under the log: "0003" after "0002 Resumable uploads". */
export function nextDecisionNumber(paths: string[], under = DECISIONS): string {
  const nums = paths
    .filter((p) => p.startsWith(`${under}/`) && !p.slice(under.length + 1).includes('/'))
    .map((p) => Number(/^(\d{1,5})\b/.exec(pageTitle(p))?.[1] ?? NaN))
    .filter((n) => !Number.isNaN(n))
  return String((nums.length ? Math.max(...nums) : 0) + 1).padStart(4, '0')
}

export interface MeetingInfo {
  title: string
  date: string
  /** "10:00–10:30" */
  time?: string | null
  room?: string | null
  organizer?: string | null
  /** Open actions from the last meeting on the same topic, with their work items. */
  carried?: ActionItem[]
  carriedFrom?: string | null
}

export function meetingNotes(m: MeetingInfo): string {
  const when = [m.time ? `${m.date} ${m.time}` : m.date, m.room && `**Room:** ${m.room}`, m.organizer && `**Organizer:** ${m.organizer}`].filter(Boolean).join(' · ')
  const carried = (m.carried ?? []).map((a) => a.raw.trim())
  return [
    `# ${m.title} – ${m.date}`,
    '',
    `**When:** ${when}`,
    '**Attendees:** ',
    '',
    '## Agenda',
    '- ',
    '',
    '## Notes',
    '',
    '## Decisions',
    '- ',
    '',
    '## Actions',
    '- [ ] @Name what to do (Create tasks turns these into Tasks)',
    ...(carried.length ? ['', `## Open from last time${m.carriedFrom ? ` ([${pageTitle(m.carriedFrom)}](${linkTo(m.carriedFrom)}))` : ''}`, ...carried] : []),
    '',
  ].join('\n')
}

export function decisionPage(title: string, date: string, by: string | null): string {
  return [
    `# ${title}`,
    '',
    `**Status:** Proposed · **Decided by:** ${by ?? ''} · **Date:** ${date}`,
    '',
    '## Context',
    'What made this decision necessary.',
    '',
    '## Decision',
    'What we will do.',
    '',
    '## Consequences',
    'What this affects (link work items, e.g. #123).',
    '',
  ].join('\n')
}

export function feedbackPage(title: string, date: string): string {
  return [
    `# ${title}`,
    '',
    `**From:**  · **Date:** ${date} · **Status:** New`,
    '',
    '> What they said, in their words.',
    '',
    '## Became',
    'The User Need or Requirement this became, e.g. - #123',
    '',
  ].join('\n')
}

/** A wiki link to a page: spaces as "-", a real "-" as "%2D". */
export const linkTo = (path: string) => path.split('/').map((s) => encodeURIComponent(s).replace(/-/g, '%2D').replace(/%20/g, '-')).join('/')

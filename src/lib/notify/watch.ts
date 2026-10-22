import type { PrDetail, PullRequest } from '../pr/types'
import type { WorkItem } from '../types'

export type NoteKind = 'review' | 'assigned' | 'mention' | 'check'

export interface Note {
  /** Stable per event, so the same thing is never announced twice. */
  key: string
  kind: NoteKind
  title: string
  body: string
  target: { type: 'pr'; pr: PullRequest } | { type: 'item'; id: number; project: string }
}

/** What was already seen, kept between checks and app launches. A kind with no entry has no baseline yet. */
export interface Snapshot {
  reviews?: number[]
  assigned?: number[]
  mentions?: number[]
  failing?: string[]
}

export interface Signals {
  /** Active pull requests in the organization where the user is a reviewer. */
  reviewing: PullRequest[]
  /** The user's work (My Work). */
  work: WorkItem[]
  mentions: WorkItem[]
  /** The user's own active pull requests with their failing checks. */
  failing: { pr: PullRequest; checks: string[] }[]
}

const MENTIONS_KEPT = 500

const idOf = (v: unknown) => (v as { id?: string } | undefined)?.id

/** Pull requests waiting on the user's vote: not their own, not a draft, and not yet voted on. */
export function waitingForReview(prs: PullRequest[], meId: string): PullRequest[] {
  return prs.filter((p) => p.status === 'active' && !p.isDraft && p.createdBy.id !== meId && p.reviewers.some((r) => r.id === meId && r.vote === 0 && !r.hasDeclined))
}

/** Names of the checks and blocking policies that failed. */
export function failedChecks(checks: Pick<PrDetail, 'statuses' | 'policies'>): string[] {
  // A status is reported again on each push; only the newest one per check counts.
  const latest = new Map<string, PrDetail['statuses'][number]>()
  for (const s of checks.statuses) {
    const name = s.context.genre ? `${s.context.genre}/${s.context.name}` : s.context.name
    const seen = latest.get(name)
    if (!seen || s.creationDate > seen.creationDate) latest.set(name, s)
  }
  const out = [...latest.values()].filter((s) => s.state === 'failed' || s.state === 'error').map((s) => s.context.name)
  for (const p of checks.policies) {
    if ((p.status === 'rejected' || p.status === 'broken') && p.configuration?.isBlocking !== false) out.push(p.configuration?.type?.displayName ?? 'Policy')
  }
  return [...new Set(out)]
}

const title = (w: WorkItem) => String(w.fields['System.Title'] ?? '')
const project = (w: WorkItem) => String(w.fields['System.TeamProject'] ?? '')

/** New events since `prev`. A kind with no baseline in `prev` only records one, so a first run is quiet. */
export function diff(prev: Snapshot | null, s: Signals, meId: string): { notes: Note[]; next: Required<Snapshot> } {
  const reviewing = waitingForReview(s.reviewing, meId)
  const assigned = s.work.filter((w) => idOf(w.fields['System.AssignedTo']) === meId)
  const failingKeys = s.failing.flatMap((f) => f.checks.map((c) => `${f.pr.pullRequestId}:${c}`))
  const next: Required<Snapshot> = {
    reviews: reviewing.map((p) => p.pullRequestId),
    assigned: assigned.map((w) => w.id),
    // Additive: an item drops out of the recent-mentions query and can come back on any later edit,
    // which is not a new mention. Kept for the newest few hundred ids.
    mentions: [...new Set([...s.mentions.map((w) => w.id), ...(prev?.mentions ?? [])])].slice(0, MENTIONS_KEPT),
    failing: failingKeys,
  }
  const was = prev ?? {}
  const notes: Note[] = []
  for (const p of reviewing) {
    if (!was.reviews || was.reviews.includes(p.pullRequestId)) continue
    notes.push({ key: `review:${p.pullRequestId}`, kind: 'review', title: `Review requested: !${p.pullRequestId}`, body: `${p.createdBy.displayName}: ${p.title}`, target: { type: 'pr', pr: p } })
  }
  for (const w of assigned) {
    // Taking an item yourself is not news.
    if (!was.assigned || was.assigned.includes(w.id) || idOf(w.fields['System.ChangedBy']) === meId) continue
    notes.push({ key: `assigned:${w.id}`, kind: 'assigned', title: `Assigned to you: #${w.id}`, body: title(w), target: { type: 'item', id: w.id, project: project(w) } })
  }
  for (const w of s.mentions) {
    if (!was.mentions || was.mentions.includes(w.id) || idOf(w.fields['System.ChangedBy']) === meId) continue
    const by = (w.fields['System.ChangedBy'] as { displayName?: string } | undefined)?.displayName
    notes.push({ key: `mention:${w.id}`, kind: 'mention', title: by ? `${by} mentioned you in #${w.id}` : `You were mentioned in #${w.id}`, body: title(w), target: { type: 'item', id: w.id, project: project(w) } })
  }
  for (const f of was.failing ? s.failing : []) {
    const fresh = f.checks.filter((c) => !was.failing?.includes(`${f.pr.pullRequestId}:${c}`))
    if (fresh.length === 0) continue
    notes.push({ key: `check:${f.pr.pullRequestId}:${fresh.join(',')}`, kind: 'check', title: `${fresh.join(', ')} failed on !${f.pr.pullRequestId}`, body: f.pr.title, target: { type: 'pr', pr: f.pr } })
  }
  return { notes, next }
}

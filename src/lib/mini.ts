import type { PullRequest } from './pr/types'
import type { Booking } from './rooms/types'
import type { WorkItem } from './types'
import { waitingForReview } from './notify/watch'
import { isFinished, stateCategory, type TypesByProject } from '@/store/useMyWorkStore'
import { clock } from '@/store/useRoomStore'

const changed = (it: WorkItem) => Date.parse(String(it.fields['System.ChangedDate'] ?? '')) || 0

/** What I am working on now: my items in an In Progress state, most recently changed first. */
export function activeWork(items: WorkItem[] | null, types: TypesByProject, max = 5): WorkItem[] {
  return (items ?? [])
    .filter((it) => !isFinished(it, types) && stateCategory(it, types) === 'InProgress')
    .sort((a, b) => changed(b) - changed(a))
    .slice(0, max)
}

/** Pull requests waiting on my vote, then my own open ones. */
export function prsForMe(prs: PullRequest[], meId: string): { review: PullRequest[]; mine: PullRequest[] } {
  const review = waitingForReview(prs, meId)
  const mine = prs.filter((p) => p.status === 'active' && p.createdBy.id === meId)
  return { review, mine }
}

export type PrStanding = 'draft' | 'conflicts' | 'rejected' | 'waiting' | 'approved' | 'pending'

/** One word for where my pull request stands with its reviewers. */
export function prStanding(pr: PullRequest): PrStanding {
  if (pr.isDraft) return 'draft'
  if (pr.mergeStatus === 'conflicts') return 'conflicts'
  const votes = pr.reviewers.filter((r) => !r.isContainer || r.vote !== 0).map((r) => r.vote)
  if (votes.some((v) => v === -10)) return 'rejected'
  if (votes.some((v) => v === -5)) return 'waiting'
  const required = pr.reviewers.filter((r) => r.isRequired)
  const approved = (v: number) => v >= 5
  if (required.length ? required.every((r) => approved(r.vote)) : votes.some(approved)) return 'approved'
  return 'pending'
}

/** The first booking still to come or going on now. */
export function nextBooking(bookings: Booking[] | null, now = Date.now()): Booking | null {
  return (bookings ?? []).filter((b) => new Date(b.end_dt).getTime() > now).sort((a, b) => new Date(a.start_dt).getTime() - new Date(b.start_dt).getTime())[0] ?? null
}

/** "in 12 min", "now", "at 2:30pm" or "Tue 9:00am" for a booking's start. */
export function startsIn(b: Booking, now = Date.now()): string {
  const start = new Date(b.start_dt)
  const mins = Math.round((start.getTime() - now) / 60000)
  if (mins <= 0) return 'now'
  if (mins < 60) return `in ${mins} min`
  const time = clock(start.getHours() * 60 + start.getMinutes())
  return start.toDateString() === new Date(now).toDateString() ? `at ${time}` : `${start.toLocaleDateString([], { weekday: 'short' })} ${time}`
}

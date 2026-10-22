import { tagsOf } from '../format'
import type { WorkItem } from '../types'

/** "This test case was checked against SRS #srsId as it stood at revision rev." Kept as a tag on the test case. */
export interface ReviewMark { srsId: number; rev: number }

export interface SpecChange { rev: number; date: string; by: string; field: string; oldValue: string; newValue: string }

const MARK = /^reviewed:SRS#(\d+)@(\d+)$/i
const markTag = (m: ReviewMark) => `reviewed:SRS#${m.srsId}@${m.rev}`

export const reviewMarks = (t: WorkItem): ReviewMark[] =>
  tagsOf(t).map((tag) => MARK.exec(tag.trim())).filter((m): m is RegExpExecArray => !!m).map((m) => ({ srsId: Number(m[1]), rev: Number(m[2]) }))

/** The tags with this SRS's mark set to `mark`, replacing an older one. */
export function withReviewMark(tags: string, mark: ReviewMark): string {
  const kept = tags.split(';').map((t) => t.trim()).filter((t) => t && !(MARK.exec(t) && Number(MARK.exec(t)![1]) === mark.srsId))
  return [...kept, markTag(mark)].join('; ')
}

interface Update { rev?: number; revisedDate?: string; revisedBy?: { displayName?: string }; fields?: Record<string, { oldValue?: unknown; newValue?: unknown }> }

/** The first change after `sinceRev` to any of `fields`, from a work item's update history. */
export function specChangedSince(updates: unknown[], fields: string[], sinceRev: number): SpecChange | null {
  for (const u of updates as Update[]) {
    if ((u.rev ?? 0) <= sinceRev) continue
    const field = fields.find((f) => u.fields?.[f])
    if (!field) continue
    const v = u.fields![field]
    return { rev: u.rev ?? 0, date: u.revisedDate ?? '', by: u.revisedBy?.displayName ?? '', field, oldValue: String(v.oldValue ?? ''), newValue: String(v.newValue ?? '') }
  }
  return null
}

/** The revision an item had at `when` (0 when it did not exist yet). */
export function baselineRev(updates: unknown[], when: string): number {
  const at = new Date(when).getTime()
  return (updates as Update[]).filter((u) => new Date(u.revisedDate ?? 0).getTime() <= at).reduce((m, u) => Math.max(m, u.rev ?? 0), 0)
}

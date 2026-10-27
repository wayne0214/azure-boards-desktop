import type { PullRequest } from '@/lib/pr/types'
import type { Iteration, WorkItemType } from '@/lib/types'
import type { FoundItem } from './types'

/** Finished by its own process: a Completed (or Resolved) state of its type. */
export function isDone(types: WorkItemType[], type: string | null, state: string | null): boolean {
  const cat = types.find((t) => t.name === type)?.states.find((s) => s.name === state)?.category
  if (cat) return cat === 'Completed' || cat === 'Resolved'
  return /^(done|closed|completed|resolved)$/i.test(state ?? '')
}

export const prUrl = (org: string, pr: PullRequest) =>
  `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(pr.repository.project?.name ?? '')}/_git/${encodeURIComponent(pr.repository.name)}/pullrequest/${pr.pullRequestId}`

const plural = (t: string) => (/s$/i.test(t) ? t : /[^aeiou]y$/i.test(t) ? `${t.slice(0, -1)}ies` : `${t}s`)
const day = (iso?: string | null) => (iso ? iso.slice(0, 10) : '')
const mdText = (s: string | null | undefined) => (s ?? '').replace(/([[\]])/g, '\\$1').trim()

function byType(items: FoundItem[]): string[] {
  const groups = new Map<string, FoundItem[]>()
  for (const it of items) groups.set(it.type ?? 'Other', [...(groups.get(it.type ?? 'Other') ?? []), it])
  // "#123" alone: Boards and the Azure DevOps wiki both show it with the item's title.
  return [...groups.entries()].flatMap(([type, list]) => [`### ${plural(type)}`, ...list.map((i) => `- #${i.id}`), ''])
}

const prLine = (org: string, pr: PullRequest) => `- [!${pr.pullRequestId} ${mdText(pr.title)}](${prUrl(org, pr)}) · ${pr.repository.name} · ${pr.createdBy.displayName ?? ''}`

/** A sprint review page: what finished, what did not, and what merged during the sprint. */
export function sprintReview(o: { sprint: Iteration; items: FoundItem[]; types: WorkItemType[]; prs: PullRequest[]; org: string }): string {
  const done = o.items.filter((i) => isDone(o.types, i.type, i.state))
  const open = o.items.filter((i) => !isDone(o.types, i.type, i.state) && i.state !== 'Removed')
  const start = o.sprint.attributes?.startDate ?? null
  const end = o.sprint.attributes?.finishDate ?? null
  const merged = o.prs.filter((p) => p.status === 'completed' && p.closedDate && (!start || day(p.closedDate) >= day(start)) && (!end || day(p.closedDate) <= day(end)))
  return [
    `# Sprint review – ${o.sprint.name}`,
    '',
    `**Dates:** ${day(start) || '?'} – ${day(end) || '?'} · **Finished:** ${done.length} of ${done.length + open.length}`,
    '',
    '_Drafted by Boards from the sprint’s work items and merged pull requests. Edit it, then save._',
    '',
    '## Finished',
    ...(done.length ? byType(done) : ['Nothing finished yet.', '']),
    '## Not finished',
    ...(open.length ? [...open.map((i) => `- #${i.id} (${i.state ?? ''})`), ''] : ['Everything planned is finished.', '']),
    '## Merged pull requests',
    ...(merged.length ? [...merged.map((p) => prLine(o.org, p)), ''] : ['None in these dates.', '']),
    '## Demo notes',
    '',
    '## What went well, what to change',
    '- ',
    '',
  ].join('\n')
}

/** Release notes: work items of the pull requests merged since a date, as new and fixed; pull requests without one listed apart. */
export function releaseNotes(o: { title: string; since: string; prs: PullRequest[]; itemsByPr: Map<number, FoundItem[]>; org: string }): string {
  const merged = o.prs.filter((p) => p.status === 'completed' && p.closedDate && day(p.closedDate) >= o.since).sort((a, b) => (b.closedDate ?? '').localeCompare(a.closedDate ?? ''))
  const seen = new Set<number>()
  const fixed: FoundItem[] = []
  const added: FoundItem[] = []
  const bare: PullRequest[] = []
  for (const pr of merged) {
    const items = o.itemsByPr.get(pr.pullRequestId) ?? []
    if (items.length === 0) bare.push(pr)
    for (const it of items) {
      if (seen.has(it.id)) continue
      seen.add(it.id)
      ;(/bug|issue|defect/i.test(it.type ?? '') ? fixed : added).push(it)
    }
  }
  const line = (i: FoundItem) => `- #${i.id}`
  return [
    `# Release notes – ${o.title}`,
    '',
    `**Since:** ${o.since} · **Pull requests merged:** ${merged.length}`,
    '',
    '_Drafted by Boards from merged pull requests and their work items. Edit it, then save._',
    '',
    '## New',
    ...(added.length ? added.map(line) : ['- ']),
    '',
    '## Fixed',
    ...(fixed.length ? fixed.map(line) : ['- ']),
    '',
    ...(bare.length ? ['## Other changes', ...bare.map((p) => prLine(o.org, p)), ''] : []),
  ].join('\n')
}

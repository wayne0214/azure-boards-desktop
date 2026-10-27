import { api } from '@/lib/api'
import type { Iteration, Project } from '@/lib/types'
import { releaseNotes, sprintReview } from './drafts'
import type { FoundItem } from './types'

/** Most pull requests and work items read for release notes; a long gap is summarised by its latest changes. */
const MAX_PRS = 60
const MAX_ITEMS = 120

/** The team's sprints, newest first, and the one running now. */
export async function sprintsOf(org: string, project: Project, team: string): Promise<{ sprints: Iteration[]; current: Iteration | null }> {
  const ctx = await api().getTeamContext(org, project.id, project.name, team)
  const sprints = [...ctx.iterations].sort((a, b) => (b.attributes?.startDate ?? '').localeCompare(a.attributes?.startDate ?? ''))
  return { sprints, current: sprints.find((s) => s.attributes?.timeFrame === 'current') ?? sprints.find((s) => s.attributes?.timeFrame === 'past') ?? sprints[0] ?? null }
}

export async function draftSprintReview(org: string, project: Project, team: string | null, sprint: Iteration): Promise<string> {
  const [found, types, prs] = await Promise.all([
    api().wikiFindItems(org, project.name, team, { iteration: sprint.path, limit: 300 }),
    api().workItemTypes(org, project.name),
    api().prList(org, project.name, 'completed', { top: 200 }),
  ])
  return sprintReview({ sprint, items: found.items.filter((i) => !/^(Test Case|Shared Steps|Test Suite|Test Plan)$/.test(i.type ?? '')), types, prs, org })
}

export async function draftReleaseNotes(org: string, project: Project, title: string, since: string): Promise<string> {
  const prs = (await api().prList(org, project.name, 'completed', { top: 200 }))
    .filter((p) => (p.closedDate ?? '').slice(0, 10) >= since)
    .slice(0, MAX_PRS)
  const idsByPr = new Map(await Promise.all(prs.map(async (p) => [p.pullRequestId, await api().prWorkItemIds(org, p.repository.id, p.pullRequestId).catch(() => [] as number[])] as const)))
  const ids = [...new Set([...idsByPr.values()].flat())].slice(0, MAX_ITEMS)
  const items = new Map<number, FoundItem>()
  await Promise.all(ids.map(async (id) => {
    const w = await api().getWorkItem(org, project.name, id).catch(() => null)
    if (!w) return
    const f = w.fields
    items.set(id, { id, type: String(f['System.WorkItemType'] ?? ''), title: String(f['System.Title'] ?? ''), state: String(f['System.State'] ?? ''), assignedTo: null, iteration: null, key: null, changed: null })
  }))
  const itemsByPr = new Map([...idsByPr].map(([pr, list]) => [pr, list.map((id) => items.get(id)).filter((i): i is FoundItem => !!i)]))
  return releaseNotes({ title, since, prs, itemsByPr, org })
}

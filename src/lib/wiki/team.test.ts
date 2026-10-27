import { describe, expect, it } from 'vitest'
import type { Identity, WorkItemType } from '@/lib/types'
import type { PullRequest } from '@/lib/pr/types'
import { actionOwner, linkTasks, newActions, parseActions, taskTitle } from './actions'
import { parseBlock, sinceDate } from './blocks'
import { isDone, releaseNotes, sprintReview } from './drafts'
import { appendToSection, childPages, linkToPath, pageMeta } from './pages'
import { linkTo, meetingNotes, nextDecisionNumber } from './templates'
import type { FoundItem } from './types'

const people: Identity[] = [
  { id: '11111111-1111-1111-1111-111111111111', displayName: 'Priya Natarajan', uniqueName: 'priya@example.com' },
  { id: '22222222-2222-2222-2222-222222222222', displayName: 'Tomás Ferreira' },
  { id: '33333333-3333-3333-3333-333333333333', displayName: 'Tom Hardy' },
]

describe('action items', () => {
  const page = '# Notes\n\n## Actions\n- [ ] @Priya Natarajan check the upload limit\n- [x] done already\n- [ ] Priya: spike uploads – #1164\n- [ ] @<22222222-2222-2222-2222-222222222222> retake button\n```\n- [ ] not an action\n```'

  it('finds open actions that have no work item yet', () => {
    expect(parseActions(page)).toHaveLength(4)
    expect(newActions(page, people).map((a) => a.text)).toEqual(['@Priya Natarajan check the upload limit', '@<22222222-2222-2222-2222-222222222222> retake button'])
  })

  it('works out the owner and the task title', () => {
    expect(actionOwner('@Priya Natarajan check it', people)?.displayName).toBe('Priya Natarajan')
    expect(actionOwner('@<22222222-2222-2222-2222-222222222222> x', people)?.displayName).toBe('Tomás Ferreira')
    expect(actionOwner('Priya: spike', people)?.displayName).toBe('Priya Natarajan')
    // "Tom" starts two names: nobody, rather than the wrong one.
    expect(actionOwner('Tom: retake', people)).toBeNull()
    expect(actionOwner('Tomas: retake', people)?.displayName).toBe('Tomás Ferreira')
    expect(taskTitle('@Priya Natarajan check the upload limit', people)).toBe('check the upload limit')
    expect(taskTitle('Priya: spike uploads –', people)).toBe('spike uploads')
    expect(taskTitle('Ask legal: is this fine?', people)).toBe('Ask legal: is this fine?')
  })

  it('adds the new Task to its line, even after other edits', () => {
    const edited = `Intro added meanwhile\n${page}`
    const out = linkTasks(edited, [{ raw: '- [ ] @Priya Natarajan check the upload limit', id: 1201 }])
    expect(out).toContain('- [ ] @Priya Natarajan check the upload limit #1201')
    expect(out.startsWith('Intro added meanwhile')).toBe(true)
  })
})

describe('templates', () => {
  it('numbers decisions after the highest one', () => {
    expect(nextDecisionNumber(['/Decision log', '/Decision log/0001 A', '/Decision log/0002 B', '/Decision log/0002 B/Notes', '/Other/0009 C'])).toBe('0003')
    expect(nextDecisionNumber([])).toBe('0001')
  })

  it('carries open actions into the next meeting', () => {
    const carried = parseActions('- [ ] Priya: spike uploads #1164')
    const md = meetingNotes({ title: 'Sprint planning', date: '2026-10-27', time: '10:00–10:30', room: 'Room A', carried, carriedFrom: '/Meeting notes/2026-10-20 Sprint planning' })
    expect(md).toContain('# Sprint planning – 2026-10-27')
    expect(md).toContain('**When:** 2026-10-27 10:00–10:30 · **Room:** Room A')
    expect(md).toContain('[2026-10-20 Sprint planning](/Meeting-notes/2026%2D10%2D20-Sprint-planning)')
    expect(md).toContain('- [ ] Priya: spike uploads #1164')
  })

  it('writes wiki links that lead back to the page', () => {
    const p = '/Decision log/0002 Re-try uploads'
    expect(linkToPath(linkTo(p), '/Home')).toBe(p)
  })
})

describe('page facts', () => {
  it('reads status, who and when', () => {
    expect(pageMeta('# 0001\n\n**Status:** Accepted · **Decided by:** Wayne · 2026-09-02\n\nText')).toEqual({ status: 'Accepted', by: 'Wayne', from: null, date: '2026-09-02' })
    expect(pageMeta('# F\n\n**From:** Dr. Lee · **Date:** 2026-10-03 · **Status:** New').from).toBe('Dr. Lee')
  })

  it('adds a line to a section, replacing its placeholder', () => {
    const page = '# F\n\n## Became\nNot linked yet.\n\n## Notes\nx'
    expect(appendToSection(page, 'Became', '- #12', /^Not linked yet\.?$/)).toBe('# F\n\n## Became\n- #12\n\n## Notes\nx\n')
    expect(appendToSection('# F\n\n## Became\n- #1', 'Became', '- #2')).toBe('# F\n\n## Became\n- #1\n- #2\n')
    expect(appendToSection('# F', 'Became', '- #2')).toBe('# F\n\n## Became\n- #2\n')
  })

  it('lists a page’s children in order', () => {
    const tree = { path: '/', subPages: [{ path: '/A', order: 0, subPages: [{ path: '/A/2', order: 1 }, { path: '/A/1', order: 0 }] }] }
    expect(childPages(tree, '/A')).toEqual(['/A/1', '/A/2'])
    expect(childPages(tree, '/B')).toEqual([])
  })
})

describe('live blocks', () => {
  const now = new Date('2026-10-26T12:00:00Z')
  it('reads a work item query', () => {
    expect(parseBlock('items: Bug, User Story\nstate: Active\nsprint: current\nassigned: me\nchanged: 7d\nlimit: 5', now)).toEqual({
      kind: 'items', filter: { types: ['Bug', 'User Story'], states: ['Active'], iteration: 'current', assignedToMe: true, changedSince: '2026-10-19', limit: 5 },
    })
    expect(parseBlock('items: all', now)).toEqual({ kind: 'items', filter: { limit: 50 } })
  })

  it('reads the other kinds and explains mistakes', () => {
    expect(parseBlock('item: #1182')).toEqual({ kind: 'item', id: 1182 })
    expect(parseBlock('prs: completed\nrepo: app')).toEqual({ kind: 'prs', status: 'completed', repo: 'app', limit: 10 })
    expect(parseBlock('decisions')).toEqual({ kind: 'pages', list: 'decisions', under: null })
    expect(parseBlock('prs: merged').kind).toBe('error')
    expect(parseBlock('cats: 3').kind).toBe('error')
    expect(parseBlock('items: Bug\nchanged: soon').kind).toBe('error')
    expect(sinceDate('2 weeks', now)).toBe('2026-10-12')
  })
})

describe('drafts', () => {
  const types = [{ name: 'Bug', states: [{ name: 'Done', category: 'Completed' }, { name: 'Active', category: 'InProgress' }] }] as unknown as WorkItemType[]
  const item = (id: number, type: string, state: string): FoundItem => ({ id, type, title: `Item ${id}`, state, assignedTo: null, iteration: null, key: null, changed: null })
  const pr = (id: number, closed: string): PullRequest => ({ pullRequestId: id, title: `PR ${id}`, status: 'completed', closedDate: closed, repository: { id: 'r', name: 'app', project: { id: 'p', name: 'P' } }, createdBy: { id: 'u', displayName: 'Ann' } } as unknown as PullRequest)

  it('tells finished items by their process', () => {
    expect(isDone(types, 'Bug', 'Done')).toBe(true)
    expect(isDone(types, 'Bug', 'Active')).toBe(false)
    expect(isDone([], 'Task', 'Closed')).toBe(true)
  })

  it('drafts a sprint review from the sprint’s dates', () => {
    const md = sprintReview({ sprint: { id: 'i', name: 'Sprint 13', path: 'P\\Sprint 13', attributes: { startDate: '2026-10-20T00:00:00Z', finishDate: '2026-11-02T00:00:00Z' } }, items: [item(1, 'Bug', 'Done'), item(2, 'Bug', 'Active')], types, prs: [pr(7, '2026-10-21T10:00:00Z'), pr(8, '2026-10-01T10:00:00Z')], org: 'o' })
    expect(md).toContain('**Finished:** 1 of 2')
    expect(md).toContain('### Bugs\n- #1\n')
    expect(md).toContain('- #2 (Active)')
    expect(md).toContain('[!7 PR 7](https://dev.azure.com/o/P/_git/app/pullrequest/7)')
    expect(md).not.toContain('!8')
  })

  it('drafts release notes as new and fixed', () => {
    const md = releaseNotes({ title: '1.4.0', since: '2026-10-10', prs: [pr(7, '2026-10-21T10:00:00Z'), pr(9, '2026-10-22T10:00:00Z')], itemsByPr: new Map([[7, [item(1, 'Bug', 'Done'), item(3, 'User Story', 'Done')]]]), org: 'o' })
    expect(md).toContain('## New\n- #3')
    expect(md).toContain('## Fixed\n- #1')
    expect(md).toContain('## Other changes\n- [!9 PR 9]')
  })
})

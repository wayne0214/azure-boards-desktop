// Demo pull request data for browser mode.
import type { Api } from './api'
import type { BranchWorkItem, Comment, PrDetail, PullRequest, Thread } from './pr/types'

const delay = (ms = 200) => new Promise((r) => setTimeout(r, ms))
const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString()

const me = { id: 'u1', displayName: 'Wayne Lai', uniqueName: 'wayne@example.com' }
const priya = { id: 'u2', displayName: 'Priya Natarajan', uniqueName: 'priya@example.com' }
const marcus = { id: 'u3', displayName: 'Marcus Oyelaran', uniqueName: 'marcus@example.com' }
const hana = { id: 'u4', displayName: 'Hana Kobayashi', uniqueName: 'hana@example.com' }

const repos = [
  { id: 'r1', name: 'contoso-mobile', defaultBranch: 'refs/heads/main', project: { id: 'p1', name: 'Contoso Mobile' } },
  { id: 'r2', name: 'contoso-api', defaultBranch: 'refs/heads/main', project: { id: 'p1', name: 'Contoso Mobile' } },
  { id: 'r3', name: 'fabrikam-web', defaultBranch: 'refs/heads/main', project: { id: 'p2', name: 'Fabrikam Web' } },
]

const branches = [{ name: 'refs/heads/main', objectId: 'def456' }, { name: 'refs/heads/develop', objectId: 'dev1' }, { name: 'refs/heads/feature/upload-resume', objectId: 'abc123' }, { name: 'refs/heads/fix/cobb-rounding', objectId: 'c0b123' }]

/** Demo branch creation; throws like Azure DevOps when the name is taken. */
export function addMockBranch(name: string): string {
  const full = `refs/heads/${name.replace(/^refs\/heads\//, '')}`
  if (branches.some((b) => b.name === full)) throw { kind: 'validation', message: `A branch named ${name} already exists.` }
  branches.push({ name: full, objectId: 'def456' })
  return full
}

let prs: PullRequest[] = [
  {
    pullRequestId: 412, title: 'Resume chunked uploads after a network drop', status: 'active', createdBy: priya, creationDate: daysAgo(2),
    sourceRefName: 'refs/heads/feature/upload-resume', targetRefName: 'refs/heads/main', mergeStatus: 'succeeded', repository: repos[0],
    reviewers: [{ ...me, vote: 0, isRequired: true }, { ...marcus, vote: 10 }],
    lastMergeSourceCommit: { commitId: 'abc123' }, lastMergeTargetCommit: { commitId: 'def456' },
    description: 'Uploads now resume from the last acknowledged chunk.\n\n- Store the resume token in the keychain\n- Retry with backoff\n\nFixes #1164.',
    workItemRefs: [{ id: '1164', url: '' }],
  },
  {
    pullRequestId: 410, title: 'Fix Cobb angle rounding mismatch between app and report', status: 'active', createdBy: me, creationDate: daysAgo(4),
    sourceRefName: 'refs/heads/fix/cobb-rounding', targetRefName: 'refs/heads/main', mergeStatus: 'conflicts', repository: repos[1],
    reviewers: [{ ...hana, vote: -5 }, { ...priya, vote: 0 }],
    lastMergeSourceCommit: { commitId: 'c0b123' }, lastMergeTargetCommit: { commitId: 'def456' },
    description: 'Both sides now round half away from zero to one decimal.',
  },
  {
    pullRequestId: 407, title: 'Onboarding copy and camera guidance', status: 'active', isDraft: true, createdBy: hana, creationDate: daysAgo(1),
    sourceRefName: 'refs/heads/feature/onboarding', targetRefName: 'refs/heads/main', mergeStatus: 'succeeded', repository: repos[0],
    reviewers: [{ ...me, vote: 0 }],
    lastMergeSourceCommit: { commitId: 'onb001' }, lastMergeTargetCommit: { commitId: 'def456' },
  },
  {
    pullRequestId: 55, title: 'Export sleep study summary as PDF', status: 'active', createdBy: hana, creationDate: daysAgo(3),
    sourceRefName: 'refs/heads/feature/pdf-export', targetRefName: 'refs/heads/main', mergeStatus: 'succeeded', repository: { id: 'r3', name: 'fabrikam-web', defaultBranch: 'refs/heads/main', project: { id: 'p2', name: 'Fabrikam Web' } },
    reviewers: [{ ...me, vote: 0 }],
    lastMergeSourceCommit: { commitId: 'pdf001' }, lastMergeTargetCommit: { commitId: 'def456' },
  },
  {
    pullRequestId: 398, title: 'Clinic admin invites', status: 'completed', createdBy: me, creationDate: daysAgo(12), closedDate: daysAgo(9),
    sourceRefName: 'refs/heads/feature/invites', targetRefName: 'refs/heads/main', mergeStatus: 'succeeded', repository: repos[1],
    reviewers: [{ ...priya, vote: 10 }],
  },
]

const oldFile = `import { upload } from './client'

export async function uploadScan(file: Blob) {
  const chunks = split(file, 512 * 1024)
  for (const chunk of chunks) {
    await upload(chunk)
  }
  return true
}

function split(file: Blob, size: number): Blob[] {
  const out: Blob[] = []
  for (let i = 0; i < file.size; i += size) out.push(file.slice(i, i + size))
  return out
}
`
const newFile = `import { upload, resumeToken, saveToken } from './client'

export async function uploadScan(file: Blob) {
  const chunks = split(file, 512 * 1024)
  const start = (await resumeToken(file)) ?? 0
  for (let i = start; i < chunks.length; i++) {
    await withRetry(() => upload(chunks[i]))
    await saveToken(file, i + 1)
  }
  return true
}

async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown
  for (let a = 0; a < attempts; a++) {
    try { return await fn() } catch (e) { last = e; await new Promise((r) => setTimeout(r, 300 * 2 ** a)) }
  }
  throw last
}

function split(file: Blob, size: number): Blob[] {
  const out: Blob[] = []
  for (let i = 0; i < file.size; i += size) out.push(file.slice(i, i + size))
  return out
}
`

let threadSeq = 100
let commentSeq = 1000
const threads: Record<number, Thread[]> = {
  412: [
    {
      id: 90, status: 'active', publishedDate: daysAgo(1), threadContext: { filePath: '/src/upload/uploadScan.ts', rightFileStart: { line: 7, offset: 1 }, rightFileEnd: { line: 7, offset: 40 } },
      comments: [
        { id: 900, author: marcus, publishedDate: daysAgo(1), commentType: 'text', content: 'Should we cap the total retries across chunks too? A flaky link could spin for a long time.' },
        { id: 901, parentCommentId: 900, author: priya, publishedDate: daysAgo(0.5), commentType: 'text', content: 'Good point, the service has a 10 min window. I will add an overall deadline.' },
      ],
    },
    {
      id: 91, status: 'fixed', publishedDate: daysAgo(1.5), threadContext: { filePath: '/src/upload/uploadScan.ts', rightFileStart: { line: 1, offset: 1 }, rightFileEnd: { line: 1, offset: 10 } },
      comments: [{ id: 902, author: me, publishedDate: daysAgo(1.5), commentType: 'text', content: 'Nit: sort imports.' }],
    },
    {
      id: 92, status: 'active', publishedDate: daysAgo(2), threadContext: null,
      comments: [{ id: 903, author: priya, publishedDate: daysAgo(2), commentType: 'text', content: 'Ready for review. Tested on a throttled connection with 3G profile.' }],
    },
    {
      id: 93, publishedDate: daysAgo(2), threadContext: null,
      comments: [{ id: 904, author: priya, publishedDate: daysAgo(2), commentType: 'system', content: 'Priya Natarajan created the pull request' }],
    },
  ],
}

export const mockPr: Pick<Api, 'prListRepos' | 'prList' | 'prDetail' | 'prWorkItemIds' | 'prBranchWorkItems' | 'prLinkWorkItem' | 'prChanges' | 'prThreads' | 'prCreateThread' | 'prReply' | 'prUpdateThread' | 'prUpdateComment' | 'prDeleteComment' | 'prVote' | 'prAddReviewer' | 'prRemoveReviewer' | 'prUpdate' | 'prCreate' | 'prBranches' | 'prGet' | 'prChecks' | 'prFile' | 'prProjectMembers'> = {
  prListRepos: async (_o, project) => { await delay(); return structuredClone(repos.filter((r) => r.project.name === project)) },
  prList: async (_o, project, status, opts) => {
    await delay(250)
    return structuredClone(prs.filter((p) => (!project || p.repository.project?.name === project) && (status === 'all' || p.status === status) && (!opts?.creatorId || p.createdBy.id === opts.creatorId) && (!opts?.reviewerId || p.reviewers.some((r) => r.id === opts.reviewerId)) && (!opts?.repoId || p.repository.id === opts.repoId)))
  },
  prDetail: async (_o, _pid, _r, prId) => {
    await delay(300)
    const pr = prs.find((p) => p.pullRequestId === prId)!
    const d: PrDetail = {
      pr: structuredClone(pr),
      iterations: [{ id: 1, createdDate: pr.creationDate, sourceRefCommit: { commitId: 'it1' }, targetRefCommit: { commitId: 'def456' } }, { id: 2, createdDate: daysAgo(1), sourceRefCommit: { commitId: pr.lastMergeSourceCommit?.commitId ?? 'x' }, targetRefCommit: { commitId: 'def456' } }],
      threads: structuredClone(threads[prId] ?? []),
      commits: [{ commitId: 'abc1234567', comment: 'Resume uploads from last acknowledged chunk', author: { name: pr.createdBy.displayName, date: daysAgo(2) } }, { commitId: 'bcd2345678', comment: 'Add retry with backoff', author: { name: pr.createdBy.displayName, date: daysAgo(1) } }],
      workItems: pr.workItemRefs ?? [],
      statuses: [{ id: 1, state: 'succeeded', context: { name: 'CI / build', genre: 'continuous-integration' }, description: 'Build succeeded', creationDate: daysAgo(1) }],
      policies: [{ evaluationId: 'e1', status: 'approved', configuration: { type: { displayName: 'Minimum number of reviewers' }, isBlocking: true } }, { evaluationId: 'e2', status: pr.mergeStatus === 'conflicts' ? 'rejected' : 'approved', configuration: { type: { displayName: 'Build' }, isBlocking: true } }],
    }
    return d
  },
  prWorkItemIds: async (_o, _r, prId) => { await delay(100); return (prs.find((p) => p.pullRequestId === prId)?.workItemRefs ?? []).map((w) => Number(w.id)) },
  prBranchWorkItems: async (_o, _p, _r, source) => {
    await delay(300)
    if (source.endsWith('main')) return []
    const item = (id: number, type: string, title: string, linkedVia: BranchWorkItem['linkedVia']): BranchWorkItem => ({ id, rev: 1, fields: { 'System.Title': title, 'System.WorkItemType': type, 'System.State': 'Active' }, linkedVia })
    return [item(1164, 'Task', 'Resume interrupted uploads', ['branch', 'commit']), item(1171, 'Bug', 'Upload stalls on a flaky network', ['mention'])]
  },
  prLinkWorkItem: async (_o, _p, repoId, prId, workItemId, linked) => {
    await delay(200)
    prs = prs.map((p) => {
      if (p.pullRequestId !== prId || p.repository.id !== repoId) return p
      const refs = (p.workItemRefs ?? []).filter((w) => Number(w.id) !== workItemId)
      return { ...p, workItemRefs: linked ? [...refs, { id: String(workItemId), url: '' }] : refs }
    })
  },
  prChanges: async () => {
    await delay(200)
    return { changeEntries: [
      { changeTrackingId: 1, changeId: 1, changeType: 'edit', item: { path: '/src/upload/uploadScan.ts', gitObjectType: 'blob' } },
      { changeTrackingId: 2, changeId: 2, changeType: 'add', item: { path: '/src/upload/client.ts', gitObjectType: 'blob' } },
      { changeTrackingId: 3, changeId: 3, changeType: 'delete', item: { path: '/src/upload/legacy.ts', gitObjectType: 'blob' } },
      { changeTrackingId: 4, changeId: 4, changeType: 'edit', item: { path: '/docs/upload.png', gitObjectType: 'blob' } },
    ] }
  },
  prThreads: async (_o, _r, prId) => structuredClone(threads[prId] ?? []),
  prCreateThread: async (_o, _r, prId, body) => {
    await delay(200)
    const b = body as { comments: { content: string }[]; threadContext?: Thread['threadContext']; status?: number }
    const t: Thread = { id: threadSeq++, status: 'active', publishedDate: new Date().toISOString(), threadContext: b.threadContext ?? null, comments: [{ id: commentSeq++, author: me, publishedDate: new Date().toISOString(), commentType: 'text', content: b.comments[0].content }] }
    threads[prId] = [...(threads[prId] ?? []), t]
    return structuredClone(t)
  },
  prReply: async (_o, _r, prId, threadId, parentId, content) => {
    await delay(200)
    const c: Comment = { id: commentSeq++, parentCommentId: parentId, author: me, publishedDate: new Date().toISOString(), commentType: 'text', content }
    threads[prId].find((t) => t.id === threadId)!.comments.push(c)
    return structuredClone(c)
  },
  prUpdateThread: async (_o, _r, prId, threadId, body) => {
    await delay(150)
    const t = threads[prId].find((x) => x.id === threadId)!
    const st = (body as { status?: number | string }).status
    const map: Record<string, Thread['status']> = { '1': 'active', '2': 'fixed', '3': 'wontFix', '4': 'closed', '5': 'byDesign', '6': 'pending' }
    if (st !== undefined) t.status = map[String(st)] ?? (st as Thread['status'])
    return structuredClone(t)
  },
  prUpdateComment: async (_o, _r, prId, threadId, commentId, content) => {
    const c = threads[prId].find((x) => x.id === threadId)!.comments.find((x) => x.id === commentId)!
    c.content = content; c.lastUpdatedDate = new Date().toISOString()
    return structuredClone(c)
  },
  prDeleteComment: async (_o, _r, prId, threadId, commentId) => {
    const c = threads[prId].find((x) => x.id === threadId)!.comments.find((x) => x.id === commentId)!
    c.isDeleted = true; c.content = ''
  },
  prVote: async (_o, _r, prId, reviewerId, vote) => {
    await delay(200)
    const pr = prs.find((p) => p.pullRequestId === prId)!
    const rv = pr.reviewers.find((r) => r.id === reviewerId)
    if (rv) rv.vote = vote; else pr.reviewers.push({ ...me, vote })
    return {}
  },
  prAddReviewer: async (_o, _r, prId, reviewerId, required) => {
    const pr = prs.find((p) => p.pullRequestId === prId)!
    const who = [me, priya, marcus, hana].find((x) => x.id === reviewerId) ?? me
    if (!pr.reviewers.some((r) => r.id === reviewerId)) pr.reviewers.push({ ...who, vote: 0, isRequired: required })
    return {}
  },
  prRemoveReviewer: async (_o, _r, prId, reviewerId) => {
    const pr = prs.find((p) => p.pullRequestId === prId)!
    pr.reviewers = pr.reviewers.filter((r) => r.id !== reviewerId)
  },
  prUpdate: async (_o, _r, prId, body) => {
    await delay(300)
    const pr = prs.find((p) => p.pullRequestId === prId)!
    const b = body as Partial<PullRequest> & { autoCompleteSetBy?: { id: string } }
    if (b.status === 'completed') {
      if (pr.mergeStatus === 'conflicts') throw { kind: 'validation', message: 'The pull request has merge conflicts and cannot be completed.' }
      // Like Azure DevOps, the merge is queued: the pull request reads as active for a few seconds.
      setTimeout(() => { pr.status = 'completed'; pr.closedDate = new Date().toISOString() }, 4000)
    }
    if (b.status === 'abandoned') pr.status = 'abandoned'
    if (b.status === 'active') pr.status = 'active'
    if (b.title) pr.title = b.title
    if (b.description !== undefined) pr.description = b.description
    if (b.isDraft !== undefined) pr.isDraft = b.isDraft
    if (b.autoCompleteSetBy) pr.autoCompleteSetBy = b.autoCompleteSetBy.id === '00000000-0000-0000-0000-000000000000' ? null : me
    if (b.completionOptions) pr.completionOptions = b.completionOptions
    return structuredClone(pr)
  },
  prCreate: async (_o, repoId, body) => {
    await delay(300)
    const b = body as { title: string; description?: string; sourceRefName: string; targetRefName: string; isDraft?: boolean; reviewers?: { id: string; isRequired?: boolean }[]; workItemRefs?: { id: string }[] }
    const pr: PullRequest = { pullRequestId: 420 + prs.length, title: b.title, description: b.description, status: 'active', isDraft: b.isDraft, createdBy: me, creationDate: new Date().toISOString(), sourceRefName: b.sourceRefName, targetRefName: b.targetRefName, mergeStatus: 'succeeded', repository: repos.find((r) => r.id === repoId)!, reviewers: (b.reviewers ?? []).map((r) => ({ ...([me, priya, marcus, hana].find((x) => x.id === r.id) ?? me), vote: 0, isRequired: r.isRequired })), lastMergeSourceCommit: { commitId: 'new1' }, lastMergeTargetCommit: { commitId: 'def456' }, workItemRefs: (b.workItemRefs ?? []).map((w) => ({ id: w.id, url: '' })) }
    prs = [pr, ...prs]
    return structuredClone(pr)
  },
  prProjectMembers: async () => [me, priya, marcus, hana],
  prBranches: async () => structuredClone(branches),
  prChecks: async (_o, _pid, _r, prId) => {
    const pr = prs.find((p) => p.pullRequestId === prId)
    return {
      statuses: [{ id: 1, state: pr?.mergeStatus === 'conflicts' ? 'failed' : 'succeeded', context: { name: 'CI / build', genre: 'continuous-integration' }, creationDate: daysAgo(1) }],
      policies: [],
    }
  },
  prGet: async (_o, _r, prId) => {
    const pr = prs.find((p) => p.pullRequestId === prId)
    if (!pr) throw { kind: 'not_found', message: `Pull request ${prId} not found` }
    return structuredClone(pr)
  },
  prFile: async (_o, _r, path, commit) => {
    await delay(150)
    if (path.endsWith('.png')) return null
    if (path.endsWith('legacy.ts')) return commit === 'def456' ? 'export const legacy = true\n' : null
    if (path.endsWith('client.ts')) return commit === 'def456' ? null : "export async function upload(chunk: Blob) { /* ... */ }\nexport async function resumeToken(file: Blob) { return 0 }\nexport async function saveToken(file: Blob, i: number) {}\n"
    return commit === 'def456' ? oldFile : newFile
  },
}
